import type { Env, AuthenticatedRequest, Vault, VaultMember, VaultRole } from "./types";

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function errorResponse(message: string, status = 400): Response {
    return jsonResponse({ error: message }, status);
}

/** Check if user is a member of the vault with any of the allowed roles */
async function checkMembership(params: {
    db: D1Database;
    vaultId: string;
    userId: string;
    allowedRoles?: VaultRole[];
}): Promise<VaultMember | null> {
    const member = await params.db
        .prepare("SELECT * FROM vault_members WHERE vault_id = ? AND clerk_user_id = ?")
        .bind(params.vaultId, params.userId)
        .first<{ vault_id: string; clerk_user_id: string; role: VaultRole; joined_at: string }>();

    if (!member) return null;

    const mapped: VaultMember = {
        vaultId: member.vault_id,
        clerkUserId: member.clerk_user_id,
        role: member.role,
        joinedAt: member.joined_at,
    };

    if (params.allowedRoles && !params.allowedRoles.includes(mapped.role)) {
        return null;
    }

    return mapped;
}

/** POST /api/vaults - Create a new vault */
export async function createVault(params: {
    env: Env;
    auth: AuthenticatedRequest;
    body: { name: string; clerkOrgId: string };
}): Promise<Response> {
    const { env, auth, body } = params;
    const { name, clerkOrgId } = body;

    if (!name || !clerkOrgId) {
        return errorResponse("name and clerkOrgId are required");
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.batch([
        env.DB.prepare(
            "INSERT INTO vaults (id, name, clerk_org_id, owner_clerk_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(id, name, clerkOrgId, auth.userId, now, now),
        env.DB.prepare(
            "INSERT INTO vault_members (vault_id, clerk_user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        ).bind(id, auth.userId, now),
    ]);

    const vault: Vault = {
        id,
        name,
        clerkOrgId,
        ownerClerkUserId: auth.userId,
        githubOwner: null,
        githubRepo: null,
        githubBranch: "main",
        createdAt: now,
        updatedAt: now,
    };

    return jsonResponse(vault, 201);
}

/** GET /api/vaults - List vaults the user belongs to */
export async function listVaults(params: {
    env: Env;
    auth: AuthenticatedRequest;
}): Promise<Response> {
    const { env, auth } = params;

    const results = await env.DB.prepare(`
        SELECT v.* FROM vaults v
        INNER JOIN vault_members vm ON v.id = vm.vault_id
        WHERE vm.clerk_user_id = ?
        ORDER BY v.updated_at DESC
    `)
        .bind(auth.userId)
        .all<{
            id: string;
            name: string;
            clerk_org_id: string;
            owner_clerk_user_id: string;
            github_owner: string | null;
            github_repo: string | null;
            github_branch: string;
            created_at: string;
            updated_at: string;
        }>();

    const vaults: Vault[] = (results.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        clerkOrgId: row.clerk_org_id,
        ownerClerkUserId: row.owner_clerk_user_id,
        githubOwner: row.github_owner,
        githubRepo: row.github_repo,
        githubBranch: row.github_branch,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));

    return jsonResponse({ vaults });
}

/** GET /api/vaults/:id - Get vault details */
export async function getVault(params: {
    env: Env;
    auth: AuthenticatedRequest;
    vaultId: string;
}): Promise<Response> {
    const { env, auth, vaultId } = params;

    const member = await checkMembership({ db: env.DB, vaultId, userId: auth.userId });
    if (!member) {
        return errorResponse("Vault not found or access denied", 404);
    }

    const row = await env.DB.prepare("SELECT * FROM vaults WHERE id = ?")
        .bind(vaultId)
        .first<{
            id: string;
            name: string;
            clerk_org_id: string;
            owner_clerk_user_id: string;
            github_owner: string | null;
            github_repo: string | null;
            github_branch: string;
            created_at: string;
            updated_at: string;
        }>();

    if (!row) {
        return errorResponse("Vault not found", 404);
    }

    const vault: Vault = {
        id: row.id,
        name: row.name,
        clerkOrgId: row.clerk_org_id,
        ownerClerkUserId: row.owner_clerk_user_id,
        githubOwner: row.github_owner,
        githubRepo: row.github_repo,
        githubBranch: row.github_branch,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    // Also fetch members
    const membersResult = await env.DB.prepare(
        "SELECT * FROM vault_members WHERE vault_id = ?",
    )
        .bind(vaultId)
        .all<{ vault_id: string; clerk_user_id: string; role: VaultRole; joined_at: string }>();

    const members: VaultMember[] = (membersResult.results ?? []).map((m) => ({
        vaultId: m.vault_id,
        clerkUserId: m.clerk_user_id,
        role: m.role,
        joinedAt: m.joined_at,
    }));

    return jsonResponse({ vault, members, currentUserRole: member.role });
}

/** DELETE /api/vaults/:id - Delete a vault (owner only) */
export async function deleteVault(params: {
    env: Env;
    auth: AuthenticatedRequest;
    vaultId: string;
}): Promise<Response> {
    const { env, auth, vaultId } = params;

    const member = await checkMembership({
        db: env.DB,
        vaultId,
        userId: auth.userId,
        allowedRoles: ["owner"],
    });
    if (!member) {
        return errorResponse("Only the vault owner can delete it", 403);
    }

    await env.DB.batch([
        env.DB.prepare("DELETE FROM vault_members WHERE vault_id = ?").bind(vaultId),
        env.DB.prepare("DELETE FROM vaults WHERE id = ?").bind(vaultId),
    ]);

    return jsonResponse({ success: true });
}

/** POST /api/vaults/:id/members - Add a member */
export async function addMember(params: {
    env: Env;
    auth: AuthenticatedRequest;
    vaultId: string;
    body: { clerkUserId: string; role: VaultRole };
}): Promise<Response> {
    const { env, auth, vaultId, body } = params;

    const member = await checkMembership({
        db: env.DB,
        vaultId,
        userId: auth.userId,
        allowedRoles: ["owner"],
    });
    if (!member) {
        return errorResponse("Only the vault owner can add members", 403);
    }

    if (!body.clerkUserId || !body.role) {
        return errorResponse("clerkUserId and role are required");
    }

    const validRoles: VaultRole[] = ["owner", "editor", "viewer"];
    if (!validRoles.includes(body.role)) {
        return errorResponse("Invalid role. Must be owner, editor, or viewer");
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
        "INSERT OR REPLACE INTO vault_members (vault_id, clerk_user_id, role, joined_at) VALUES (?, ?, ?, ?)",
    ).bind(vaultId, body.clerkUserId, body.role, now).run();

    return jsonResponse({ success: true }, 201);
}

/** DELETE /api/vaults/:id/members/:uid - Remove a member */
export async function removeMember(params: {
    env: Env;
    auth: AuthenticatedRequest;
    vaultId: string;
    memberUserId: string;
}): Promise<Response> {
    const { env, auth, vaultId, memberUserId } = params;

    const member = await checkMembership({
        db: env.DB,
        vaultId,
        userId: auth.userId,
        allowedRoles: ["owner"],
    });
    if (!member) {
        return errorResponse("Only the vault owner can remove members", 403);
    }

    if (memberUserId === auth.userId) {
        return errorResponse("Cannot remove yourself. Transfer ownership first.");
    }

    await env.DB.prepare(
        "DELETE FROM vault_members WHERE vault_id = ? AND clerk_user_id = ?",
    ).bind(vaultId, memberUserId).run();

    return jsonResponse({ success: true });
}

/** PATCH /api/vaults/:id/members/:uid - Update member role */
export async function updateMemberRole(params: {
    env: Env;
    auth: AuthenticatedRequest;
    vaultId: string;
    memberUserId: string;
    body: { role: VaultRole };
}): Promise<Response> {
    const { env, auth, vaultId, memberUserId, body } = params;

    const member = await checkMembership({
        db: env.DB,
        vaultId,
        userId: auth.userId,
        allowedRoles: ["owner"],
    });
    if (!member) {
        return errorResponse("Only the vault owner can update roles", 403);
    }

    const validRoles: VaultRole[] = ["owner", "editor", "viewer"];
    if (!validRoles.includes(body.role)) {
        return errorResponse("Invalid role");
    }

    await env.DB.prepare(
        "UPDATE vault_members SET role = ? WHERE vault_id = ? AND clerk_user_id = ?",
    ).bind(body.role, vaultId, memberUserId).run();

    return jsonResponse({ success: true });
}
