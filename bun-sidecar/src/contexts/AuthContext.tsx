import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";

interface TeamAuthContextValue {
    isSignedIn: boolean;
    userId: string | null;
    userName: string | null;
    userImageUrl: string | null;
    getToken: () => Promise<string | null>;
    signOut: () => Promise<void>;
    signIn: () => Promise<void>;
}

const TeamAuthContext = createContext<TeamAuthContextValue | null>(null);

interface AuthStatusResponse {
    isSignedIn: boolean;
    user: {
        id: string;
        clerkUserId: string;
        name: string | null;
        email: string | null;
        imageUrl: string | null;
    } | null;
}

/**
 * AuthProvider polls the local Bun server for auth state.
 * Sign-in happens in the system browser via the hosted auth proxy.
 * The Swift native app forwards the `nomendex://auth-callback` URL back
 * to the WebView via `window.__authCallback`.
 */
export function AuthProvider(props: { children: React.ReactNode }) {
    const [isSignedIn, setIsSignedIn] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [userName, setUserName] = useState<string | null>(null);
    const [userImageUrl, setUserImageUrl] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Poll auth status from the local Bun server
    const pollStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/status");
            if (!res.ok) return;
            const data = (await res.json()) as AuthStatusResponse;
            setIsSignedIn(data.isSignedIn);
            if (data.isSignedIn && data.user) {
                setUserId(data.user.id);
                setUserName(data.user.name);
                setUserImageUrl(data.user.imageUrl);
            } else {
                setUserId(null);
                setUserName(null);
                setUserImageUrl(null);
            }
        } catch {
            // Ignore fetch failures — server may not be ready yet
        }
    }, []);

    // Start polling on mount
    useEffect(() => {
        // Immediate check
        pollStatus();

        // Fast poll (2s) until signed in, then slow poll (30s) to stay in sync
        function setupPoll() {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(() => {
                pollStatus();
            }, isSignedIn ? 30_000 : 2_000);
        }
        setupPoll();

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [isSignedIn, pollStatus]);

    // Register the global __authCallback for Swift to call
    useEffect(() => {
        const win = window as Window & { __authCallback?: (code: string, state: string) => void };
        win.__authCallback = async (code: string, state: string) => {
            try {
                const res = await fetch("/api/auth/callback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code, state }),
                });
                if (res.ok) {
                    // Trigger an immediate status poll
                    await pollStatus();
                } else {
                    console.error("[auth] Callback failed:", res.status);
                }
            } catch (err) {
                console.error("[auth] Callback error:", err);
            }
        };
        return () => {
            delete win.__authCallback;
        };
    }, [pollStatus]);

    const getToken = useCallback(async (): Promise<string | null> => {
        try {
            const res = await fetch("/api/auth/token");
            if (!res.ok) return null;
            const data = (await res.json()) as { token: string | null };
            return data.token;
        } catch {
            return null;
        }
    }, []);

    const signOut = useCallback(async () => {
        try {
            await fetch("/api/auth/sign-out", { method: "POST" });
            setIsSignedIn(false);
            setUserId(null);
            setUserName(null);
            setUserImageUrl(null);
        } catch {
            // Best effort
        }
    }, []);

    const signIn = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/start-sign-in", { method: "POST" });
            if (!res.ok) return;
            const data = (await res.json()) as { url: string };

            // Try to open via Swift message handler
            const webkit = (window as Window & {
                webkit?: {
                    messageHandlers?: {
                        openAuthUrl?: { postMessage: (msg: { url: string }) => void };
                    };
                };
            }).webkit;

            if (webkit?.messageHandlers?.openAuthUrl) {
                webkit.messageHandlers.openAuthUrl.postMessage({ url: data.url });
            } else {
                // Fallback: open in a new browser tab (dev mode)
                window.open(data.url, "_blank");
            }
        } catch (err) {
            console.error("[auth] Sign-in error:", err);
        }
    }, []);

    const value = useMemo<TeamAuthContextValue>(() => ({
        isSignedIn,
        userId,
        userName,
        userImageUrl,
        getToken,
        signOut,
        signIn,
    }), [isSignedIn, userId, userName, userImageUrl, getToken, signOut, signIn]);

    return (
        <TeamAuthContext.Provider value={value}>
            {props.children}
        </TeamAuthContext.Provider>
    );
}

/**
 * Hook to access team auth state. Returns safe defaults when not signed in
 * or when no TeamAuthContext is provided.
 */
export function useTeamAuth(): TeamAuthContextValue {
    const context = useContext(TeamAuthContext);

    // Fallback when AuthProvider is not mounted (shouldn't happen now, but safe)
    if (!context) {
        return {
            isSignedIn: false,
            userId: null,
            userName: null,
            userImageUrl: null,
            getToken: async () => null,
            signOut: async () => {},
            signIn: async () => {},
        };
    }

    return context;
}
