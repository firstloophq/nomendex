import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { prisma } from "../db";
import { UserSchema } from "../schemas/user";
import { ErrorResponseSchema } from "../schemas/common";
import type { AuthVariables } from "../auth";

const app = new OpenAPIHono<{ Variables: AuthVariables }>();

const getMeRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["User"],
  summary: "Get current user profile",
  responses: {
    200: {
      description: "Current user profile",
      content: { "application/json": { schema: UserSchema } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

app.openapi(getMeRoute, async (c) => {
  const userId = c.get("userId");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    id: user.id,
    clerkUserId: user.clerkUserId,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }, 200);
});

export default app;
