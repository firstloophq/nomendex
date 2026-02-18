import { z } from "@hono/zod-openapi";
import { UserSchema } from "./user";

export const OrgSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Org");

export const OrgMembershipSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    userId: z.string(),
    role: z.string(),
    joinedAt: z.string().datetime(),
    user: UserSchema,
  })
  .openapi("OrgMembership");

export const OrgDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    memberships: z.array(OrgMembershipSchema),
  })
  .openapi("OrgDetail");

export const CreateOrgSchema = z
  .object({
    name: z.string().min(1).max(100),
  })
  .openapi("CreateOrg");

export const UpdateOrgSchema = z
  .object({
    name: z.string().min(1).max(100),
  })
  .openapi("UpdateOrg");

export const AddMemberSchema = z
  .object({
    clerkUserId: z.string().optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => data.clerkUserId || data.email, {
    message: "Either clerkUserId or email must be provided",
  })
  .openapi("AddMember");
