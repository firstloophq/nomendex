import { globalConfig, type AuthUser } from "../storage/global-config";

// ---------------------------------------------------------------------------
// In-memory auth state
// ---------------------------------------------------------------------------

let currentJwt: string | null = null;
let jwtExpiresAt: number | null = null;
let clerkSessionId: string | null = null;
let authUser: AuthUser | null = null;
let authState: string | null = null; // CSRF nonce for sign-in flow
let refreshInterval: ReturnType<typeof setInterval> | null = null;

function resolveTeamBackendUrl(): string {
    return (
        process.env.TEAM_BACKEND_HTTP_URL?.trim() ||
        process.env.TEAM_BACKEND_URL?.trim() ||
        "http://localhost:4444"
    );
}

const teamBackendUrl = resolveTeamBackendUrl();

async function refreshJwtNow(): Promise<string | null> {
    if (!clerkSessionId) return null;

    try {
        const deviceId = await globalConfig.getOrCreateDeviceId();
        const res = await fetch(`${teamBackendUrl}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clerkSessionId, deviceId }),
        });

        if (!res.ok) {
            if (res.status === 401) {
                await clearAuthState();
            }
            return null;
        }

        const data = (await res.json()) as { jwt: string; expiresAt: string };
        currentJwt = data.jwt;
        jwtExpiresAt = new Date(data.expiresAt).getTime();
        return currentJwt;
    } catch (err) {
        console.error("[auth] Refresh error:", err instanceof Error ? err.message : String(err));
        return null;
    }
}

function isJwtFresh(): boolean {
    if (!currentJwt || !jwtExpiresAt) return false;
    // Refresh proactively if token expires within 60 seconds.
    return jwtExpiresAt - Date.now() > 60_000;
}

// ---------------------------------------------------------------------------
// Refresh loop
// ---------------------------------------------------------------------------

function startRefreshLoop() {
    stopRefreshLoop();

    refreshInterval = setInterval(async () => {
        if (!clerkSessionId) return;

        try {
            await refreshJwtNow();
        } catch (err) {
            console.error("[auth] Refresh error:", err instanceof Error ? err.message : String(err));
        }
    }, 4 * 60 * 1000); // Every 4 minutes
}

function stopRefreshLoop() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

async function clearAuthState() {
    currentJwt = null;
    jwtExpiresAt = null;
    clerkSessionId = null;
    authUser = null;
    authState = null;
    stopRefreshLoop();
    await globalConfig.setPersistedAuth({ auth: null });
}

// ---------------------------------------------------------------------------
// Init from persisted state (called on server startup)
// ---------------------------------------------------------------------------

export async function initAuthFromPersistedState() {
    const persisted = await globalConfig.getPersistedAuth();
    if (!persisted) return;

    try {
        const deviceId = await globalConfig.getOrCreateDeviceId();
        const res = await fetch(`${teamBackendUrl}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clerkSessionId: persisted.clerkSessionId, deviceId }),
        });

        if (!res.ok) {
            console.warn("[auth] Could not resume persisted session:", res.status);
            await globalConfig.setPersistedAuth({ auth: null });
            return;
        }

        const data = (await res.json()) as { jwt: string; expiresAt: string };
        currentJwt = data.jwt;
        jwtExpiresAt = new Date(data.expiresAt).getTime();
        clerkSessionId = persisted.clerkSessionId;
        authUser = persisted.user;
        startRefreshLoop();
        console.log("[auth] Resumed persisted session for", authUser?.email ?? authUser?.name);
    } catch (err) {
        console.warn("[auth] Failed to resume persisted session:", err instanceof Error ? err.message : String(err));
        await globalConfig.setPersistedAuth({ auth: null });
    }
}

export async function getCurrentAuthToken(): Promise<string | null> {
    if (isJwtFresh()) {
        return currentJwt;
    }
    return await refreshJwtNow();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const authRoutes: Record<string, Record<string, (req: Request) => Response | Promise<Response>>> = {
    "/api/auth/status": {
        GET() {
            return Response.json({
                isSignedIn: currentJwt !== null && authUser !== null,
                user: authUser,
            });
        },
    },

    "/api/auth/token": {
        GET() {
            return Response.json({ token: currentJwt, expiresAt: jwtExpiresAt });
        },
    },

    "/api/auth/start-sign-in": {
        async POST(req: Request) {
            const deviceId = await globalConfig.getOrCreateDeviceId();
            authState = crypto.randomUUID();

            // Pass callback_port so the sign-in page can redirect back via HTTP (for browser testing)
            const sidecarPort = new URL(req.url).port;
            const url = `${teamBackendUrl}/auth/sign-in?device_id=${encodeURIComponent(deviceId)}&state=${encodeURIComponent(authState)}&callback_port=${encodeURIComponent(sidecarPort)}`;

            return Response.json({ url });
        },
    },

    "/api/auth/callback": {
        async POST(req: Request) {
            const body = (await req.json()) as { code: string; state: string };
            const { code, state } = body;

            if (!code || !state) {
                return Response.json({ error: "Missing code or state" }, { status: 400 });
            }

            // Verify CSRF nonce
            if (state !== authState) {
                return Response.json({ error: "Invalid state parameter" }, { status: 403 });
            }

            try {
                const deviceId = await globalConfig.getOrCreateDeviceId();
                const res = await fetch(`${teamBackendUrl}/auth/exchange`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code, deviceId }),
                });

                if (!res.ok) {
                    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
                    return Response.json(
                        { error: errBody.error ?? "Exchange failed" },
                        { status: res.status },
                    );
                }

                const data = (await res.json()) as {
                    jwt: string;
                    clerkSessionId: string;
                    user: AuthUser;
                    expiresAt: string;
                };

                // Store in memory
                currentJwt = data.jwt;
                jwtExpiresAt = new Date(data.expiresAt).getTime();
                clerkSessionId = data.clerkSessionId;
                authUser = data.user;
                authState = null; // One-time use

                // Persist session info
                await globalConfig.setPersistedAuth({
                    auth: { clerkSessionId: data.clerkSessionId, user: data.user },
                });

                // Start background refresh
                startRefreshLoop();

                return Response.json({ success: true, user: data.user });
            } catch (err) {
                console.error("[auth/callback] Error:", err instanceof Error ? err.message : String(err));
                return Response.json({ error: "Internal error" }, { status: 500 });
            }
        },
    },

    // Browser-redirect callback: sign-in page redirects here with code & state as query params
    "/auth/callback": {
        async GET(req: Request) {
            const url = new URL(req.url);
            const code = url.searchParams.get("code") ?? "";
            const state = url.searchParams.get("state") ?? "";

            if (!code || !state) {
                return new Response("Missing code or state", { status: 400 });
            }

            if (state !== authState) {
                return new Response("Invalid state parameter", { status: 403 });
            }

            try {
                const deviceId = await globalConfig.getOrCreateDeviceId();
                const res = await fetch(`${teamBackendUrl}/auth/exchange`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code, deviceId }),
                });

                if (!res.ok) {
                    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
                    return new Response(`Auth exchange failed: ${errBody.error ?? res.status}`, { status: res.status });
                }

                const data = (await res.json()) as {
                    jwt: string;
                    clerkSessionId: string;
                    user: AuthUser;
                    expiresAt: string;
                };

                currentJwt = data.jwt;
                jwtExpiresAt = new Date(data.expiresAt).getTime();
                clerkSessionId = data.clerkSessionId;
                authUser = data.user;
                authState = null;

                await globalConfig.setPersistedAuth({
                    auth: { clerkSessionId: data.clerkSessionId, user: data.user },
                });

                startRefreshLoop();

                // Redirect back to the app
                const appUrl = `http://localhost:${url.port}/`;
                return Response.redirect(appUrl, 302);
            } catch (err) {
                console.error("[auth/callback GET] Error:", err instanceof Error ? err.message : String(err));
                return new Response("Internal error", { status: 500 });
            }
        },
    },

    "/api/auth/sign-out": {
        async POST() {
            if (clerkSessionId) {
                try {
                    const deviceId = await globalConfig.getOrCreateDeviceId();
                    await fetch(`${teamBackendUrl}/auth/revoke`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ clerkSessionId, deviceId }),
                    });
                } catch (err) {
                    console.warn("[auth] Revoke error (non-fatal):", err instanceof Error ? err.message : String(err));
                }
            }

            await clearAuthState();
            return Response.json({ success: true });
        },
    },
};
