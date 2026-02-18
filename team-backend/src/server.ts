import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware, type AuthVariables } from "./auth";
import meRoutes from "./routes/me";
import orgsRoutes from "./routes/orgs";
import membersRoutes from "./routes/members";
import githubRoutes, { handleGitHubCallback } from "./routes/github";
import orgWorkspacesRoutes from "./routes/org-workspaces";

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Health check (no auth)
app.get("/health", (c) => c.json({ status: "ok" }));

// GitHub App callback (no auth — receives installation_id + state from GitHub redirect)
app.get("/github/callback", (c) => handleGitHubCallback(c.req.raw));

// Auth-protected API routes
app.use("/api/*", authMiddleware);
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
};
