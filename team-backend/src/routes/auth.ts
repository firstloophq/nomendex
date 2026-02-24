import { Hono } from "hono";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "../db";
import { verifyJWT } from "../auth";
import { logError } from "../observability/logger";

const app = new Hono();

const clerkSecretKey = process.env.CLERK_SECRET_KEY!;

const clerkClient = createClerkClient({
  secretKey: clerkSecretKey,
});

/**
 * Create a basic session JWT via the Clerk REST API.
 * The SDK's `sessions.getToken()` requires a custom JWT template — this doesn't.
 */
async function createSessionToken(sessionId: string): Promise<string> {
  const res = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clerk createSessionToken failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { jwt: string };
  return data.jwt;
}

/**
 * GET /sign-in
 * Returns an HTML page that loads Clerk's sign-in UI.
 * After sign-in, generates a one-time code and redirects to nomendex:// URL scheme.
 */
app.get("/sign-in", (c) => {
  const deviceId = c.req.query("device_id") ?? "";
  const state = c.req.query("state") ?? "";
  const callbackPort = c.req.query("callback_port") ?? "";
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const backendOrigin = new URL(c.req.url).origin;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in to Nomendex</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0a0a0a; color: #fff; }
    #sign-in-container { min-width: 320px; }
    #status { text-align: center; padding: 20px; color: #888; }
    .error { color: #ef4444 !important; }
  </style>
</head>
<body>
  <div id="sign-in-container"></div>
  <div id="status">Loading...</div>
  <script>
    const DEVICE_ID = ${JSON.stringify(deviceId)};
    const STATE = ${JSON.stringify(state)};
    const CALLBACK_PORT = ${JSON.stringify(callbackPort)};
    const BACKEND_ORIGIN = ${JSON.stringify(backendOrigin)};

    async function loadClerk() {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      script.crossOrigin = "anonymous";
      script.dataset.clerkPublishableKey = ${JSON.stringify(publishableKey)};
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
      });

      const clerk = window.Clerk;
      await clerk.load();

      if (clerk.session) {
        document.getElementById("status").textContent = "Already signed in. Generating code...";
        await exchangeSession(clerk);
        return;
      }

      document.getElementById("status").style.display = "none";
      clerk.mountSignIn(document.getElementById("sign-in-container"), {
        afterSignInUrl: window.location.href,
      });

      // Poll for session after sign-in
      const interval = setInterval(async () => {
        if (clerk.session) {
          clearInterval(interval);
          document.getElementById("sign-in-container").innerHTML = "";
          document.getElementById("status").style.display = "block";
          document.getElementById("status").textContent = "Signed in! Generating code...";
          await exchangeSession(clerk);
        }
      }, 500);
    }

    async function exchangeSession(clerk) {
      try {
        const token = await clerk.session.getToken();
        const res = await fetch(BACKEND_ORIGIN + "/auth/create-code", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deviceId: DEVICE_ID, state: STATE }),
        });

        if (!res.ok) throw new Error("Failed to create auth code: " + res.status);
        const data = await res.json();
        const code = data.code;

        // Try nomendex:// URL scheme first
        const callbackUrl = "nomendex://auth-callback?code=" + encodeURIComponent(code) + "&state=" + encodeURIComponent(STATE);

        if (CALLBACK_PORT) {
          // Dev mode fallback: also try HTTP callback
          const httpUrl = "http://localhost:" + CALLBACK_PORT + "/auth/callback?code=" + encodeURIComponent(code) + "&state=" + encodeURIComponent(STATE);
          window.location.href = callbackUrl;
          // Fallback after a short delay
          setTimeout(() => { window.location.href = httpUrl; }, 2000);
        } else {
          window.location.href = callbackUrl;
        }

        document.getElementById("status").textContent = "Redirecting back to Nomendex...";
      } catch (err) {
        document.getElementById("status").textContent = "Error: " + err.message;
        document.getElementById("status").className = "error";
      }
    }

    loadClerk().catch((err) => {
      document.getElementById("status").textContent = "Failed to load: " + err.message;
      document.getElementById("status").className = "error";
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

/**
 * POST /create-code
 * Protected by JWT verification. Creates a one-time auth code.
 */
app.post("/create-code", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = await verifyJWT(token);
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }

  const body = await c.req.json<{ deviceId: string; state: string }>();
  const { deviceId, state } = body;

  if (!deviceId || !state) {
    return c.json({ error: "Missing deviceId or state" }, 400);
  }

  const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds

  const authCode = await prisma.authCode.create({
    data: {
      clerkUserId: payload.sub,
      clerkSessionId: payload.sid ?? "",
      deviceId,
      state,
      expiresAt,
    },
  });

  return c.json({ code: authCode.code });
});

/**
 * POST /exchange
 * Exchanges a one-time auth code for a JWT and user info.
 * No auth middleware — the code IS the credential.
 */
app.post("/exchange", async (c) => {
  const body = await c.req.json<{ code: string; deviceId: string }>();
  const { code, deviceId } = body;

  if (!code || !deviceId) {
    return c.json({ error: "Missing code or deviceId" }, 400);
  }

  // Look up auth code
  const authCode = await prisma.authCode.findFirst({
    where: {
      code,
      used: false,
      deviceId,
      expiresAt: { gt: new Date() },
    },
  });

  if (!authCode) {
    return c.json({ error: "Invalid or expired code" }, 401);
  }

  // Mark as used
  await prisma.authCode.update({
    where: { code },
    data: { used: true },
  });

  try {
    // Get session token from Clerk (basic token, no template required)
    const jwt = await createSessionToken(authCode.clerkSessionId);

    // Get session info for user data
    const session = await clerkClient.sessions.getSession(authCode.clerkSessionId);

    // Get user info from Clerk
    const clerkUser = await clerkClient.users.getUser(authCode.clerkUserId);

    // Upsert user in our DB
    const user = await prisma.user.upsert({
      where: { clerkUserId: authCode.clerkUserId },
      update: {
        name: clerkUser.fullName ?? clerkUser.username ?? null,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
        imageUrl: clerkUser.imageUrl ?? null,
      },
      create: {
        clerkUserId: authCode.clerkUserId,
        name: clerkUser.fullName ?? clerkUser.username ?? null,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
        imageUrl: clerkUser.imageUrl ?? null,
      },
    });

    // Calculate JWT expiry (Clerk tokens expire in ~60s by default)
    const expiresAt = new Date(Date.now() + 55 * 1000).toISOString();

    return c.json({
      jwt,
      clerkSessionId: authCode.clerkSessionId,
      user: {
        id: user.id,
        clerkUserId: user.clerkUserId,
        name: user.name,
        email: user.email,
        imageUrl: user.imageUrl,
      },
      expiresAt,
      sessionStatus: session.status,
    });
  } catch (err) {
    logError("auth_exchange_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "Failed to exchange code" }, 500);
  }
});

/**
 * POST /refresh
 * Refreshes a JWT using the Clerk session ID.
 */
app.post("/refresh", async (c) => {
  const body = await c.req.json<{ clerkSessionId: string; deviceId: string }>();
  const { clerkSessionId, deviceId } = body;

  if (!clerkSessionId || !deviceId) {
    return c.json({ error: "Missing clerkSessionId or deviceId" }, 400);
  }

  try {
    // Check session is still active
    const session = await clerkClient.sessions.getSession(clerkSessionId);
    if (session.status !== "active") {
      return c.json({ error: "Session is no longer active" }, 401);
    }

    // Get fresh token (basic token, no template required)
    const jwt = await createSessionToken(clerkSessionId);

    const expiresAt = new Date(Date.now() + 55 * 1000).toISOString();

    return c.json({ jwt, expiresAt });
  } catch (err) {
    logError("auth_refresh_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "Failed to refresh token" }, 401);
  }
});

/**
 * POST /revoke
 * Revokes a Clerk session.
 */
app.post("/revoke", async (c) => {
  const body = await c.req.json<{ clerkSessionId: string; deviceId: string }>();
  const { clerkSessionId, deviceId } = body;

  if (!clerkSessionId || !deviceId) {
    return c.json({ error: "Missing clerkSessionId or deviceId" }, 400);
  }

  try {
    await clerkClient.sessions.revokeSession(clerkSessionId);
    return c.json({ success: true });
  } catch (err) {
    logError("auth_revoke_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    // Return success even if revoke fails (session may already be expired)
    return c.json({ success: true });
  }
});

export default app;
