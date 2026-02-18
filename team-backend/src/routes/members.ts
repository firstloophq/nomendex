import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { prisma } from "../db";
import { OrgMembershipSchema, AddMemberSchema } from "../schemas/org";
import { ErrorResponseSchema, IdParamsSchema, MemberParamsSchema } from "../schemas/common";
import type { AuthVariables } from "../auth";

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

// GET /api/orgs/:id/members — List org members
const listMembersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Members"],
  summary: "List org members",
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "List of members",
      content: { "application/json": { schema: z.array(OrgMembershipSchema) } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(listMembersRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");

  // Check caller is a member
  const callerMembership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId: id, userId } },
  });

  if (!callerMembership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  const memberships = await prisma.orgMembership.findMany({
    where: { orgId: id },
    include: { user: true },
  });

  return c.json(
    memberships.map((m) => ({
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
    200,
  );
});

// POST /api/orgs/:id/members — Add member
const addMemberRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Members"],
  summary: "Add a member to the org",
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: AddMemberSchema } } },
  },
  responses: {
    201: {
      description: "Member added",
      content: { "application/json": { schema: OrgMembershipSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Already a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(addMemberRoute, async (c) => {
  const callerId = c.get("userId");
  const { id: orgId } = c.req.valid("param");
  const body = c.req.valid("json");

  // Check caller is a member
  const callerMembership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: callerId } },
  });

  if (!callerMembership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  // Find the target user
  let targetUser;
  if (body.clerkUserId) {
    targetUser = await prisma.user.findUnique({ where: { clerkUserId: body.clerkUserId } });
  } else if (body.email) {
    targetUser = await prisma.user.findFirst({ where: { email: body.email } });
  }

  if (!targetUser) {
    return c.json({ error: "User not found" }, 404);
  }

  // Check if already a member
  const existingMembership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: targetUser.id } },
  });

  if (existingMembership) {
    return c.json({ error: "User is already a member of this org" }, 409);
  }

  const membership = await prisma.orgMembership.create({
    data: { orgId, userId: targetUser.id, role: "admin" },
    include: { user: true },
  });

  return c.json({
    id: membership.id,
    orgId: membership.orgId,
    userId: membership.userId,
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
    user: {
      id: membership.user.id,
      clerkUserId: membership.user.clerkUserId,
      name: membership.user.name,
      email: membership.user.email,
      imageUrl: membership.user.imageUrl,
      createdAt: membership.user.createdAt.toISOString(),
      updatedAt: membership.user.updatedAt.toISOString(),
    },
  }, 201);
});

// DELETE /api/orgs/:id/members/:userId — Remove member
const removeMemberRoute = createRoute({
  method: "delete",
  path: "/{userId}",
  tags: ["Members"],
  summary: "Remove a member from the org",
  request: { params: MemberParamsSchema },
  responses: {
    200: {
      description: "Member removed",
      content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Membership not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(removeMemberRoute, async (c) => {
  const callerId = c.get("userId");
  const { id: orgId, userId: targetUserId } = c.req.valid("param");

  // Check caller is a member
  const callerMembership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: callerId } },
  });

  if (!callerMembership) {
    return c.json({ error: "Not a member of this org" }, 403);
  }

  // Find the target membership
  const targetMembership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: targetUserId } },
  });

  if (!targetMembership) {
    return c.json({ error: "Membership not found" }, 404);
  }

  await prisma.orgMembership.delete({
    where: { id: targetMembership.id },
  });

  return c.json({ success: true }, 200);
});

export default app;
