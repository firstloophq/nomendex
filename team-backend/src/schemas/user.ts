import { z } from "@hono/zod-openapi";

export const UserSchema = z
  .object({
    id: z.string(),
    clerkUserId: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    imageUrl: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("User");
