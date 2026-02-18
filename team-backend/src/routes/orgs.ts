import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { prisma } from "../db";
import { OrgSchema, OrgDetailSchema, CreateOrgSchema, UpdateOrgSchema, OrgMembershipSchema } from "../schemas/org";
import { ErrorResponseSchema, IdParamsSchema } from "../schemas/common";
import type { AuthVariables } from "../auth";

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

// POST /api/orgs — Create org
const createOrgRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Orgs"],
  summary: "Create a new org",
  request: {
    body: { content: { "application/json": { schema: CreateOrgSchema } } },
  },
  responses: {
    201: {
      description: "Org created",
      content: { "application/json": { schema: OrgDetailSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(createOrgRoute, async (c) => {
  const userId = c.get("userId");
  const { name } = c.req.valid("json");

  const org = await prisma.org.create({
    data: {
      name,
      memberships: {
        create: { userId, role: "admin" },
      },
    },
    include: {
      memberships: { include: { user: true } },
    },
  });

  return c.json({
    id: org.id,
    name: org.name,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
    memberships: org.memberships.map((m) => ({
      id: m.id,
      orgId: m.orgId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      user: {
        id: m.user.id,
        clerkUserId: m.user.clerkUserId,
        name: m.user.name,
        email: m.user.email,
        imageUrl: m.user.imageUrl,
        createdAt: m.user.createdAt.toISOString(),
        updatedAt: m.user.updatedAt.toISOString(),
      },
    })),
  }, 201);
});

// GET /api/orgs — List user's orgs
const listOrgsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Orgs"],
  summary: "List orgs the current user belongs to",
  responses: {
    200: {
      description: "List of orgs",
      content: { "application/json": { schema: z.array(OrgSchema) } },
    },
  },
});

app.openapi(listOrgsRoute, async (c) => {
  const userId = c.get("userId");

  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    include: { org: true },
  });

  const orgs = memberships.map((m) => ({
    id: m.org.id,
    name: m.org.name,
    createdAt: m.org.createdAt.toISOString(),
    updatedAt: m.org.updatedAt.toISOString(),
  }));

  return c.json(orgs, 200);
});

// GET /api/orgs/:id — Get org details
const getOrgRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Orgs"],
  summary: "Get org details with members",
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "Org details",
      content: { "application/json": { schema: OrgDetailSchema } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Org not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(getOrgRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");

  const org = await prisma.org.findUnique({
    where: { id },
    include: { memberships: { include: { user: true } } },
  });

  if (!org) {
    return c.json({ error: "Org not found" }, 404);
  }

  const isMember = org.memberships.some((m) => m.userId === userId);
  if (!isMember) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  return c.json({
    id: org.id,
    name: org.name,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
    memberships: org.memberships.map((m) => ({
      id: m.id,
      orgId: m.orgId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      user: {
        id: m.user.id,
        clerkUserId: m.user.clerkUserId,
        name: m.user.name,
        email: m.user.email,
        imageUrl: m.user.imageUrl,
        createdAt: m.user.createdAt.toISOString(),
        updatedAt: m.user.updatedAt.toISOString(),
      },
    })),
  }, 200);
});

// PATCH /api/orgs/:id — Update org
const updateOrgRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Orgs"],
  summary: "Update org name",
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateOrgSchema } } },
  },
  responses: {
    200: {
      description: "Org updated",
      content: { "application/json": { schema: OrgSchema } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Org not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(updateOrgRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const { name } = c.req.valid("json");

  // Check membership
  const membership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId: id, userId } },
  });

  if (!membership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  const org = await prisma.org.update({
    where: { id },
    data: { name },
  });

  return c.json({
    id: org.id,
    name: org.name,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  }, 200);
});

export default app;
