import type { Env, AuthenticatedRequest } from "./types";

interface ClerkJWKS {
    keys: Array<{
        kty: string;
        n: string;
        e: string;
        kid: string;
        alg: string;
        use: string;
    }>;
}

// Cache JWKS for 1 hour
let jwksCache: { keys: ClerkJWKS; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

async function getJWKS(env: Env): Promise<ClerkJWKS> {
    const now = Date.now();
    if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
        return jwksCache.keys;
    }

    // Derive the Clerk frontend API URL from the publishable key
    // Publishable keys look like: pk_test_abc...xyz or pk_live_abc...xyz
    // The base64-encoded part decodes to "{instance-id}$" — strip the trailing $
    const keyParts = env.CLERK_PUBLISHABLE_KEY.split("_");
    const rawInstanceId = keyParts.length >= 3 ? atob(keyParts.slice(2).join("_")) : "";
    const instanceId = rawInstanceId.replace(/\$$/, ""); // Strip trailing $
    const jwksUrl = instanceId
        ? `https://${instanceId}/.well-known/jwks.json`
        : `https://api.clerk.com/.well-known/jwks.json`;

    console.log("[auth] Fetching JWKS from:", jwksUrl);

    const response = await fetch(jwksUrl);
    if (!response.ok) {
        console.error("[auth] JWKS fetch failed:", response.status, await response.text());
        throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }

    const keys = (await response.json()) as ClerkJWKS;
    jwksCache = { keys, fetchedAt: now };
    return keys;
}

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

interface JWTHeader {
    alg: string;
    kid: string;
    typ: string;
}

interface JWTPayload {
    sub: string;
    exp: number;
    iat: number;
    iss: string;
    nbf?: number;
}

async function verifyJWT(token: string, env: Env): Promise<JWTPayload> {
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/"))) as JWTHeader;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as JWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
        throw new Error("Token expired");
    }

    // Find matching key
    const jwks = await getJWKS(env);
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key) {
        // Invalidate cache and retry once
        jwksCache = null;
        const freshJwks = await getJWKS(env);
        const freshKey = freshJwks.keys.find((k) => k.kid === header.kid);
        if (!freshKey) {
            throw new Error("No matching key found in JWKS");
        }
        return verifyWithKey(freshKey, headerB64, payloadB64, signatureB64, payload);
    }

    return verifyWithKey(key, headerB64, payloadB64, signatureB64, payload);
}

async function verifyWithKey(
    key: ClerkJWKS["keys"][0],
    headerB64: string,
    payloadB64: string,
    signatureB64: string,
    payload: JWTPayload,
): Promise<JWTPayload> {
    const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: key.kty, n: key.n, e: key.e, alg: key.alg, ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
    );

    const signatureBuffer = base64UrlToArrayBuffer(signatureB64);
    const dataBuffer = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        signatureBuffer,
        dataBuffer,
    );

    if (!valid) {
        throw new Error("Invalid JWT signature");
    }

    return payload;
}

/**
 * Authenticate a request by verifying the Bearer token.
 * Returns the authenticated user info or null if not authenticated.
 */
export async function authenticateRequest(
    request: Request,
    env: Env,
): Promise<AuthenticatedRequest | null> {
    // Try Authorization header first
    const authHeader = request.headers.get("Authorization");
    let token: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
    } else {
        // Fall back to query parameter (for WebSocket upgrades where headers aren't available)
        const url = new URL(request.url);
        token = url.searchParams.get("token");
    }

    if (!token) {
        console.log("[auth] No token found in header or query params");
        return null;
    }

    console.log("[auth] Token found, length:", token.length, "source:", authHeader ? "header" : "query");

    try {
        const payload = await verifyJWT(token, env);
        console.log("[auth] JWT verified, userId:", payload.sub);
        return { userId: payload.sub };
    } catch (err) {
        console.error("[auth] JWT verification failed:", err instanceof Error ? err.message : String(err));
        return null;
    }
}

/**
 * Middleware that requires authentication. Returns a 401 response if not authenticated.
 */
export async function requireAuth(
    request: Request,
    env: Env,
): Promise<AuthenticatedRequest | Response> {
    const auth = await authenticateRequest(request, env);
    if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }
    return auth;
}
