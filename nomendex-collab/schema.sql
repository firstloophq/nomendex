-- Vaults table: one per team workspace
CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    clerk_org_id TEXT NOT NULL,
    owner_clerk_user_id TEXT NOT NULL,
    github_owner TEXT,
    github_repo TEXT,
    github_branch TEXT DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vault members: tracks who has access to which vault
CREATE TABLE IF NOT EXISTS vault_members (
    vault_id TEXT NOT NULL,
    clerk_user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('owner', 'editor', 'viewer')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (vault_id, clerk_user_id),
    FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
);

-- Index for looking up vaults by member
CREATE INDEX IF NOT EXISTS idx_vault_members_user ON vault_members(clerk_user_id);
