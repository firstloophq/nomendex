import { OpenAPIHono } from "@hono/zod-openapi";
import { websocket } from "hono/bun";
import { cors } from "hono/cors";
import { authMiddleware, type AuthVariables } from "./auth";
import {
  handleCollabWebSocketUpgrade,
  hardResetCollabDoc,
  inspectCollabDoc,
} from "./collab/websocket";
import meRoutes from "./routes/me";
import orgsRoutes from "./routes/orgs";
import membersRoutes from "./routes/members";
import githubRoutes, { handleGitHubCallback } from "./routes/github";
import orgWorkspacesRoutes from "./routes/org-workspaces";
import authRoutes from "./routes/auth";
import { logError, logInfo } from "./observability/logger";
import { initTelemetry, withSpan } from "./observability/telemetry";

initTelemetry();
const app = new OpenAPIHono<{ Variables: AuthVariables }>();

function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isLocalDebugRouteEnabled(): boolean {
  const override = process.env.ENABLE_LOCAL_DEBUG_ROUTES?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  return process.env.NODE_ENV !== "production";
}

// Global middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  logInfo("http_request", {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});
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
    await withSpan({
      name: "collab.reset_doc",
      attributes: {
        "collab.doc_id": docId,
      },
      fn: async () => hardResetCollabDoc({
      docId,
      identity: {
        userId: c.get("userId"),
        clerkUserId: c.get("clerkUserId"),
        userName: c.get("userName"),
        userEmail: c.get("userEmail"),
      },
      }),
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
    logError("collab_reset_doc_failed", { docId, message });
    return c.json({ error: "Failed to reset doc" }, 500);
  }
});

app.get("/debug/collab/doc-state", async (c) => {
  if (!isLocalDebugRouteEnabled()) {
    return c.json({ error: "Not found" }, 404);
  }
  if (!isLoopbackHost(c.req.header("host") ?? null)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const docId = c.req.query("docId")?.trim();
  if (!docId) {
    return c.json({ error: "docId is required" }, 400);
  }
  const includeOps = c.req.query("includeOps") === "1";
  const includeItems = c.req.query("includeItems") === "1";
  const includePersisted = c.req.query("includePersisted") === "1";
  const includeMarkdown = c.req.query("includeMarkdown") === "1";
  const maxOps = Number(c.req.query("maxOps") ?? "200");
  const safeMaxOps = Number.isFinite(maxOps) ? Math.max(1, Math.min(maxOps, 5000)) : 200;

  try {
    const result = await withSpan({
      name: "collab.inspect_doc_local_debug",
      attributes: {
        "collab.doc_id": docId,
        "collab.include_ops": includeOps,
        "collab.include_items": includeItems,
        "collab.include_persisted": includePersisted,
        "collab.include_markdown": includeMarkdown,
        "collab.max_ops": safeMaxOps,
      },
      fn: async () => inspectCollabDoc({
        docId,
        includeOps,
        includeItems,
        includePersisted,
        includeMarkdown,
        maxOps: safeMaxOps,
        skipAccessCheck: true,
      }),
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Invalid document id format:")) {
      return c.json({ error: message }, 400);
    }
    logError("collab_inspect_doc_local_debug_failed", { docId, message });
    return c.json({ error: "Failed to inspect doc" }, 500);
  }
});
app.get("/api/collab/doc-state", async (c) => {
  const docId = c.req.query("docId")?.trim();
  if (!docId) {
    return c.json({ error: "docId is required" }, 400);
  }
  const includeOps = c.req.query("includeOps") === "1";
  const includeItems = c.req.query("includeItems") === "1";
  const includePersisted = c.req.query("includePersisted") === "1";
  const includeMarkdown = c.req.query("includeMarkdown") === "1";
  const maxOps = Number(c.req.query("maxOps") ?? "200");
  const safeMaxOps = Number.isFinite(maxOps) ? Math.max(1, Math.min(maxOps, 5000)) : 200;

  try {
    const result = await withSpan({
      name: "collab.inspect_doc",
      attributes: {
        "collab.doc_id": docId,
        "collab.include_ops": includeOps,
        "collab.include_items": includeItems,
        "collab.include_persisted": includePersisted,
        "collab.include_markdown": includeMarkdown,
        "collab.max_ops": safeMaxOps,
      },
      fn: async () => inspectCollabDoc({
        docId,
        includeOps,
        includeItems,
        includePersisted,
        includeMarkdown,
        maxOps: safeMaxOps,
        identity: {
          userId: c.get("userId"),
          clerkUserId: c.get("clerkUserId"),
          userName: c.get("userName"),
          userEmail: c.get("userEmail"),
        },
      }),
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Forbidden") {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (message.startsWith("Invalid document id format:")) {
      return c.json({ error: message }, 400);
    }
    logError("collab_inspect_doc_failed", { docId, message });
    return c.json({ error: "Failed to inspect doc" }, 500);
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
logInfo("team_backend_starting", { port });

export default {
  port,
  fetch: app.fetch,
  websocket,
};
