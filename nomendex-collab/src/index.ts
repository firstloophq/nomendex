import type { Env, AuthenticatedRequest, VaultRole } from "./types";
import { requireAuth, authenticateRequest } from "./auth";
import { routePartykitRequest } from "partyserver";
import {
    createVault,
    listVaults,
    getVault,
    deleteVault,
    addMember,
    removeMember,
    updateMemberRole,
} from "./vault-api";

export { VaultServer } from "./vault-do";

function corsHeaders(): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
}

function withCors(response: Response): Response {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders())) {
        headers.set(key, value);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // PartyServer routes (WebSocket upgrade for Y.js sync)
            // URL pattern: /parties/vault-server/:vaultId
            if (path.startsWith("/parties/")) {
                // Authenticate before handing off to partyserver
                const auth = await authenticateRequest(request, env);
                if (!auth) {
                    return withCors(
                        new Response(JSON.stringify({ error: "Unauthorized" }), {
                            status: 401,
                            headers: { "Content-Type": "application/json" },
                        }),
                    );
                }

                const partyResponse = await routePartykitRequest(request, env);
                if (partyResponse) {
                    // Don't wrap WebSocket upgrade responses
                    if (partyResponse.status === 101) return partyResponse;
                    return withCors(partyResponse);
                }
            }

            // All REST routes require authentication
            const authResult = await requireAuth(request, env);
            if (authResult instanceof Response) {
                return withCors(authResult);
            }
            const auth: AuthenticatedRequest = authResult;

            // Route matching
            const response = await routeRequest({ path, method: request.method, request, env, auth });
            // Don't wrap WebSocket upgrade responses — re-creating them breaks the handshake
            if (response.status === 101) {
                return response;
            }
            return withCors(response);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Internal server error";
            return withCors(
                new Response(JSON.stringify({ error: message }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                }),
            );
        }
    },
};

async function routeRequest(params: {
    path: string;
    method: string;
    request: Request;
    env: Env;
    auth: AuthenticatedRequest;
}): Promise<Response> {
    const { path, method, request, env, auth } = params;

    // POST /api/vaults - Create vault
    if (path === "/api/vaults" && method === "POST") {
        const body = await request.json() as { name: string; clerkOrgId: string };
        return createVault({ env, auth, body });
    }

    // GET /api/vaults - List vaults
    if (path === "/api/vaults" && method === "GET") {
        return listVaults({ env, auth });
    }

    // Match /api/vaults/:id routes
    const vaultMatch = path.match(/^\/api\/vaults\/([^/]+)$/);
    if (vaultMatch) {
        const vaultId = vaultMatch[1];

        if (method === "GET") {
            return getVault({ env, auth, vaultId });
        }
        if (method === "DELETE") {
            return deleteVault({ env, auth, vaultId });
        }
    }

    // Match /api/vaults/:id/members routes
    const membersMatch = path.match(/^\/api\/vaults\/([^/]+)\/members$/);
    if (membersMatch && method === "POST") {
        const vaultId = membersMatch[1];
        const body = await request.json() as { clerkUserId: string; role: VaultRole };
        return addMember({ env, auth, vaultId, body });
    }

    // Match /api/vaults/:id/members/:uid routes
    const memberMatch = path.match(/^\/api\/vaults\/([^/]+)\/members\/([^/]+)$/);
    if (memberMatch) {
        const vaultId = memberMatch[1];
        const memberUserId = memberMatch[2];

        if (method === "DELETE") {
            return removeMember({ env, auth, vaultId, memberUserId });
        }
        if (method === "PATCH") {
            const body = await request.json() as { role: VaultRole };
            return updateMemberRole({ env, auth, vaultId, memberUserId, body });
        }
    }

    // GitHub connection routes (Phase 4 stubs)
    const githubConnectMatch = path.match(/^\/api\/vaults\/([^/]+)\/github\/connect$/);
    if (githubConnectMatch && method === "POST") {
        return new Response(JSON.stringify({ error: "GitHub integration coming in Phase 4" }), {
            status: 501,
            headers: { "Content-Type": "application/json" },
        });
    }

    const githubDisconnectMatch = path.match(/^\/api\/vaults\/([^/]+)\/github\/disconnect$/);
    if (githubDisconnectMatch && method === "POST") {
        return new Response(JSON.stringify({ error: "GitHub integration coming in Phase 4" }), {
            status: 501,
            headers: { "Content-Type": "application/json" },
        });
    }

    const githubStatusMatch = path.match(/^\/api\/vaults\/([^/]+)\/github\/status$/);
    if (githubStatusMatch && method === "GET") {
        return new Response(JSON.stringify({ error: "GitHub integration coming in Phase 4" }), {
            status: 501,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
    });
}
