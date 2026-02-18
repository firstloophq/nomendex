import { z } from "@hono/zod-openapi";

export const GitHubInstallationSchema = z
  .object({
    id: z.string(),
    installationId: z.number(),
    accountLogin: z.string(),
    accountType: z.string(),
    accountAvatarUrl: z.string().nullable(),
    installedById: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("GitHubInstallation");

export const GitHubRepoSchema = z
  .object({
    id: z.number(),
    fullName: z.string(),
    name: z.string(),
    isPrivate: z.boolean(),
    defaultBranch: z.string(),
    htmlUrl: z.string(),
  })
  .openapi("GitHubRepo");

export const OrgWorkspaceSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    installationId: z.string(),
    repoFullName: z.string(),
    repoId: z.number(),
    defaultBranch: z.string(),
    displayName: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("OrgWorkspace");

export const CreateOrgWorkspaceSchema = z
  .object({
    installationId: z.string().min(1),
    repoFullName: z.string().min(1),
    repoId: z.number(),
    defaultBranch: z.string().default("main"),
    displayName: z.string().min(1).max(100),
  })
  .openapi("CreateOrgWorkspace");

export const InstallationTokenResponseSchema = z
  .object({
    token: z.string(),
    expiresAt: z.string().datetime(),
  })
  .openapi("InstallationTokenResponse");

export const GitHubCallbackStateSchema = z.object({
  userId: z.string(),
});
