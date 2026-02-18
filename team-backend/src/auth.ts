import { createMiddleware } from "hono/factory";
import { prisma } from "./db";

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
  name?: string;
  email?: string;
  image_url?: string;
}

// JWKS cache (1 hour TTL)
let jwksCache: { keys: ClerkJWKS; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

function decodeBase64Url(str: string): string {
  return Buffer.from(str, "base64url").toString("utf-8");
}

function base64UrlToArrayBuffer(str: string): ArrayBuffer {
  const buf = Buffer.from(str, "base64url");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function getClerkJwksUrl(): string {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("CLERK_PUBLISHABLE_KEY is not set");
  }

  const keyParts = publishableKey.split("_");
  const rawInstanceId = keyParts.length >= 3 ? decodeBase64Url(keyParts.slice(2).join("_")) : "";
  const instanceId = rawInstanceId.replace(/\$$/, "");

  return instanceId
    ? `https://${instanceId}/.well-known/jwks.json`
    : `https://api.clerk.com/.well-known/jwks.json`;
}

async function getJWKS(): Promise<ClerkJWKS> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  const jwksUrl = getClerkJwksUrl();
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

async function verifyWithKey({
  key,
  headerB64,
  payloadB64,
  signatureB64,
  payload,
}: {
  key: ClerkJWKS["keys"][0];
  headerB64: string;
  payloadB64: string;
  signatureB64: string;
  payload: JWTPayload;
}): Promise<JWTPayload> {
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

async function verifyJWT(token: string): Promise<JWTPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const _header = JSON.parse(decodeBase64Url(headerB64)) as JWTHeader;
  const payload = JSON.parse(decodeBase64Url(payloadB64)) as JWTPayload;

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("Token expired");
  }

  // Find matching key
  const jwks = await getJWKS();
  const key = jwks.keys.find((k) => k.kid === _header.kid);
  if (!key) {
    // Invalidate cache and retry once
    jwksCache = null;
    const freshJwks = await getJWKS();
    const freshKey = freshJwks.keys.find((k) => k.kid === _header.kid);
    if (!freshKey) {
      throw new Error("No matching key found in JWKS");
    }
    return verifyWithKey({ key: freshKey, headerB64, payloadB64, signatureB64, payload });
  }

  return verifyWithKey({ key, headerB64, payloadB64, signatureB64, payload });
}

export type AuthVariables = {
  userId: string;
  clerkUserId: string;
  userName: string | null;
  userEmail: string | null;
};

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  let jwtPayload: JWTPayload;
  try {
    jwtPayload = await verifyJWT(token);
  } catch (err) {
    console.error("[auth] JWT verification failed:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Upsert user in database
  const user = await prisma.user.upsert({
    where: { clerkUserId: jwtPayload.sub },
    update: {
      name: jwtPayload.name ?? null,
      email: jwtPayload.email ?? null,
      imageUrl: jwtPayload.image_url ?? null,
    },
    create: {
      clerkUserId: jwtPayload.sub,
      name: jwtPayload.name ?? null,
      email: jwtPayload.email ?? null,
      imageUrl: jwtPayload.image_url ?? null,
    },
  });

  c.set("userId", user.id);
  c.set("clerkUserId", jwtPayload.sub);
  c.set("userName", user.name);
  c.set("userEmail", user.email);

  await next();
});
