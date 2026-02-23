import { OpenAPIHono } from "@hono/zod-openapi";
import { websocket } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware, type AuthVariables } from "./auth";
import { handleCollabWebSocketUpgrade, hardResetCollabDoc } from "./collab/websocket";
import meRoutes from "./routes/me";
import orgsRoutes from "./routes/orgs";
import membersRoutes from "./routes/members";
import githubRoutes, { handleGitHubCallback } from "./routes/github";
import orgWorkspacesRoutes from "./routes/org-workspaces";
import authRoutes from "./routes/auth";

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Health check (no auth)
app.get("/health", (c) => c.json({ status: "ok" }));

// GitHub App callback (no auth — receives installation_id + state from GitHub redirect)
app.get("/github/callback", (c) => handleGitHubCallback(c.req.raw));
app.get("/ws/crdt", (c) => handleCollabWebSocketUpgrade(c));

// Auth routes (no auth middleware — handles its own auth)
app.route("/auth", authRoutes);

// Auth-protected API routes
app.use("/api/*", authMiddleware);
app.post("/api/collab/reset-doc", async (c) => {
  const body = await c.req.json().catch(() => null) as { docId?: unknown } | null;
  const docId = typeof body?.docId === "string" ? body.docId.trim() : "";
  if (!docId) {
    return c.json({ error: "docId is required" }, 400);
  }

  try {
    await hardResetCollabDoc({
      docId,
      identity: {
        userId: c.get("userId"),
        clerkUserId: c.get("clerkUserId"),
        userName: c.get("userName"),
        userEmail: c.get("userEmail"),
      },
    });
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Forbidden") {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (message.startsWith("Invalid document id format:")) {
      return c.json({ error: message }, 400);
    }
    console.error("[collab/reset-doc] failed:", message);
    return c.json({ error: "Failed to reset doc" }, 500);
  }
});
app.route("/api/me", meRoutes);
app.route("/api/orgs", orgsRoutes);
app.route("/api/orgs/:id/members", membersRoutes);
app.route("/api/github", githubRoutes);
app.route("/api/orgs/:id/workspaces", orgWorkspacesRoutes);

// OpenAPI spec (no auth)
app.doc("/openapi", {
  openapi: "3.0.0",
  info: {
    title: "Nomendex Team API",
    version: "0.1.0",
    description: "Team/org management for Nomendex",
  },
});

const port = Number(process.env.PORT) || 4444;

console.log(`[team-backend] Starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
