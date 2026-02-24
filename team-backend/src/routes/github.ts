import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { prisma } from "../db";
import {
  GitHubInstallationSchema,
  GitHubRepoSchema,
  InstallationTokenResponseSchema,
} from "../schemas/github";
import { ErrorResponseSchema, IdParamsSchema } from "../schemas/common";
import type { AuthVariables } from "../auth";
import {
  getInstallation,
  createInstallationAccessToken,
  listInstallationRepos,
} from "../github-app";
import { logError } from "../observability/logger";

// --- Authenticated routes (mounted under /api/github) ---

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

// GET /api/github/installations — List user's GitHub installations
const listInstallationsRoute = createRoute({
  method: "get",
  path: "/installations",
  tags: ["GitHub"],
  summary: "List user's GitHub App installations",
  responses: {
    200: {
      description: "List of installations",
      content: { "application/json": { schema: z.array(GitHubInstallationSchema) } },
    },
  },
});

app.openapi(listInstallationsRoute, async (c) => {
  const userId = c.get("userId");

  const installations = await prisma.gitHubInstallation.findMany({
    where: { installedById: userId },
    orderBy: { createdAt: "desc" },
  });

  return c.json(
    installations.map((inst) => ({
      id: inst.id,
      installationId: inst.installationId,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
      accountAvatarUrl: inst.accountAvatarUrl,
      installedById: inst.installedById,
      createdAt: inst.createdAt.toISOString(),
      updatedAt: inst.updatedAt.toISOString(),
    })),
    200,
  );
});

// GET /api/github/installations/:id/repos — List repos for an installation
const listInstallationReposRoute = createRoute({
  method: "get",
  path: "/installations/{id}/repos",
  tags: ["GitHub"],
  summary: "List repos accessible to a GitHub App installation",
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "List of repos",
      content: { "application/json": { schema: z.array(GitHubRepoSchema) } },
    },
    403: {
      description: "Not authorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Installation not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(listInstallationReposRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");

  const installation = await prisma.gitHubInstallation.findUnique({
    where: { id },
  });

  if (!installation) {
    return c.json({ error: "Installation not found" }, 404);
  }

  if (installation.installedById !== userId) {
    return c.json({ error: "Not authorized to access this installation" }, 403);
  }

  const tokenResult = await createInstallationAccessToken({
    installationId: installation.installationId,
  });

  const repos = await listInstallationRepos({ token: tokenResult.token });

  return c.json(repos, 200);
});

// POST /api/github/installations/:id/token — Generate fresh installation access token
const createTokenRoute = createRoute({
  method: "post",
  path: "/installations/{id}/token",
  tags: ["GitHub"],
  summary: "Generate a fresh installation access token for git operations",
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "Installation access token",
      content: { "application/json": { schema: InstallationTokenResponseSchema } },
    },
    403: {
      description: "Not authorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Installation not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(createTokenRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");

  const installation = await prisma.gitHubInstallation.findUnique({
    where: { id },
  });

  if (!installation) {
    return c.json({ error: "Installation not found" }, 404);
  }

  if (installation.installedById !== userId) {
    return c.json({ error: "Not authorized to access this installation" }, 403);
  }

  const tokenResult = await createInstallationAccessToken({
    installationId: installation.installationId,
  });

  return c.json(
    {
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt.toISOString(),
    },
    200,
  );
});

// POST /api/github/state-token — Generate a signed state token for the GitHub App install flow
const createStateTokenRoute = createRoute({
  method: "post",
  path: "/state-token",
  tags: ["GitHub"],
  summary: "Generate a state token for GitHub App installation flow",
  responses: {
    200: {
      description: "State token",
      content: {
        "application/json": {
          schema: z.object({ stateToken: z.string() }),
        },
      },
    },
  },
});

app.openapi(createStateTokenRoute, async (c) => {
  const userId = c.get("userId");

  // Create a simple signed state by encoding the userId and a timestamp
  // In production, use a proper HMAC or JWT. For now, base64 encode with a timestamp.
  const statePayload = JSON.stringify({
    userId,
    ts: Date.now(),
  });
  const stateToken = btoa(statePayload);

  return c.json({ stateToken }, 200);
});

export default app;

// --- Unauthenticated callback handler (mounted separately in server.ts) ---

/**
 * Handle the GitHub App setup/installation callback.
 * Receives `installation_id` and `state` query params.
 * Fetches installation info from GitHub API, upserts GitHubInstallation record.
 */
export async function handleGitHubCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const installationIdStr = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const setupAction = url.searchParams.get("setup_action");

  const htmlResponse = (content: string, status = 200) =>
    new Response(content, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  const jsonResponse = (data: Record<string, string>, status: number) =>
    Response.json(data, { status });

  // If this is just an install event without state, show a success page
  if (setupAction === "install" && !state) {
    return htmlResponse(`
      <!DOCTYPE html>
      <html>
      <head><title>GitHub App Installed</title></head>
      <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
        <div style="text-align: center;">
          <h2>GitHub App Connected!</h2>
          <p>You can close this window and return to Nomendex.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (!installationIdStr || !state) {
    return jsonResponse({ error: "Missing installation_id or state" }, 400);
  }

  const installationId = parseInt(installationIdStr, 10);
  if (isNaN(installationId)) {
    return jsonResponse({ error: "Invalid installation_id" }, 400);
  }

  // Decode state to get userId
  let userId: string;
  try {
    const decoded = JSON.parse(atob(state)) as { userId: string; ts: number };
    userId = decoded.userId;

    // Check if state is not too old (15 minutes)
    const age = Date.now() - decoded.ts;
    if (age > 15 * 60 * 1000) {
      return jsonResponse({ error: "State token expired" }, 400);
    }
  } catch {
    return jsonResponse({ error: "Invalid state parameter" }, 400);
  }

  // Verify user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return jsonResponse({ error: "User not found" }, 400);
  }

  // Fetch installation info from GitHub
  let installationInfo;
  try {
    installationInfo = await getInstallation({ installationId });
  } catch (err) {
    logError("github_callback_installation_fetch_failed", {
      installationId,
      message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse({ error: "Failed to fetch installation details from GitHub" }, 500);
  }

  // Upsert the installation record
  await prisma.gitHubInstallation.upsert({
    where: { installationId },
    update: {
      accountLogin: installationInfo.account.login,
      accountType: installationInfo.account.type,
      accountAvatarUrl: installationInfo.account.avatarUrl,
      installedById: userId,
    },
    create: {
      installationId,
      accountLogin: installationInfo.account.login,
      accountType: installationInfo.account.type,
      accountAvatarUrl: installationInfo.account.avatarUrl,
      installedById: userId,
    },
  });

  return htmlResponse(`
    <!DOCTYPE html>
    <html>
    <head><title>GitHub App Connected</title></head>
    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
      <div style="text-align: center;">
        <h2>Connected!</h2>
        <p>GitHub App installed for <strong>${installationInfo.account.login}</strong>.</p>
        <p>You can close this window and return to Nomendex.</p>
      </div>
    </body>
    </html>
  `);
}
