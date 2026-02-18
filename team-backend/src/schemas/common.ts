import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi("ErrorResponse");

export const IdParamsSchema = z.object({
  id: z.string().min(1).openapi({ description: "Resource ID", example: "clxyz123" }),
});

export const MemberParamsSchema = z.object({
  id: z.string().min(1).openapi({ description: "Org ID" }),
  userId: z.string().min(1).openapi({ description: "User ID" }),
});
