import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { prisma } from "../db";
import { OrgWorkspaceSchema, CreateOrgWorkspaceSchema } from "../schemas/github";
import { ErrorResponseSchema, IdParamsSchema } from "../schemas/common";
import type { AuthVariables } from "../auth";

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

// POST / — Create an OrgWorkspace (link a repo to an org)
const createOrgWorkspaceRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["OrgWorkspaces"],
  summary: "Link a GitHub repo to an org as a workspace",
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: CreateOrgWorkspaceSchema } } },
  },
  responses: {
    201: {
      description: "OrgWorkspace created",
      content: { "application/json": { schema: OrgWorkspaceSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Not a member of this org",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Repo already linked",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(createOrgWorkspaceRoute, async (c) => {
  const userId = c.get("userId");
  const { id: orgId } = c.req.valid("param");
  const body = c.req.valid("json");

  // Check org membership
  const membership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });

  if (!membership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  // Check installation ownership
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { id: body.installationId },
  });

  if (!installation) {
    return c.json({ error: "GitHub installation not found" }, 400);
  }

  // Check for existing link
  const existing = await prisma.orgWorkspace.findUnique({
    where: { orgId_repoFullName: { orgId, repoFullName: body.repoFullName } },
  });

  if (existing) {
    return c.json({ error: "This repo is already linked to this org" }, 409);
  }

  const workspace = await prisma.orgWorkspace.create({
    data: {
      orgId,
      installationId: body.installationId,
      repoFullName: body.repoFullName,
      repoId: body.repoId,
      defaultBranch: body.defaultBranch,
      displayName: body.displayName,
    },
  });

  return c.json(
    {
      id: workspace.id,
      orgId: workspace.orgId,
      installationId: workspace.installationId,
      repoFullName: workspace.repoFullName,
      repoId: workspace.repoId,
      defaultBranch: workspace.defaultBranch,
      displayName: workspace.displayName,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    },
    201,
  );
});

// GET / — List org's workspaces
const listOrgWorkspacesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["OrgWorkspaces"],
  summary: "List workspaces linked to an org",
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "List of org workspaces",
      content: { "application/json": { schema: z.array(OrgWorkspaceSchema) } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(listOrgWorkspacesRoute, async (c) => {
  const userId = c.get("userId");
  const { id: orgId } = c.req.valid("param");

  const membership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });

  if (!membership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  const workspaces = await prisma.orgWorkspace.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  return c.json(
    workspaces.map((ws) => ({
      id: ws.id,
      orgId: ws.orgId,
      installationId: ws.installationId,
      repoFullName: ws.repoFullName,
      repoId: ws.repoId,
      defaultBranch: ws.defaultBranch,
      displayName: ws.displayName,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
    })),
    200,
  );
});

// Workspace-specific params
const WorkspaceParamsSchema = z.object({
  id: z.string().min(1).openapi({ description: "Org ID" }),
  wsId: z.string().min(1).openapi({ description: "Workspace ID" }),
});

// DELETE /:wsId — Remove an OrgWorkspace
const deleteOrgWorkspaceRoute = createRoute({
  method: "delete",
  path: "/{wsId}",
  tags: ["OrgWorkspaces"],
  summary: "Remove a workspace from an org",
  request: { params: WorkspaceParamsSchema },
  responses: {
    200: {
      description: "Workspace removed",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Workspace not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(deleteOrgWorkspaceRoute, async (c) => {
  const userId = c.get("userId");
  const { id: orgId, wsId } = c.req.valid("param");

  const membership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });

  if (!membership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  const workspace = await prisma.orgWorkspace.findUnique({
    where: { id: wsId },
  });

  if (!workspace || workspace.orgId !== orgId) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  await prisma.orgWorkspace.delete({ where: { id: wsId } });

  return c.json({ success: true }, 200);
});

export default app;
