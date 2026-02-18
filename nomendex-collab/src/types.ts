export interface Env {
    VaultServer: DurableObjectNamespace;
    DB: D1Database;
    CLERK_PUBLISHABLE_KEY: string;
    CLERK_SECRET_KEY: string;
}

export type VaultRole = "owner" | "editor" | "viewer";

export interface Vault {
    id: string;
    name: string;
    clerkOrgId: string;
    ownerClerkUserId: string;
    githubOwner: string | null;
    githubRepo: string | null;
    githubBranch: string;
    createdAt: string;
    updatedAt: string;
}

export interface VaultMember {
    vaultId: string;
    clerkUserId: string;
    role: VaultRole;
    joinedAt: string;
}

export interface AuthenticatedRequest {
    userId: string;
}
