import { mkdir } from "node:fs/promises";
import path from "path";

export type TeamMode = "solo" | "team";

export interface WorkspaceInfo {
    id: string;
    path: string;
    name: string;
    createdAt: string;
    lastAccessedAt: string;
    teamVaultId?: string;
    teamMode: TeamMode;
    /** team-backend Org.id — set for GitHub-backed team workspaces */
    orgId?: string;
    /** team-backend OrgWorkspace.id */
    orgWorkspaceId?: string;
    /** "owner/repo" — presence means this is a GitHub-backed workspace */
    repoFullName?: string;
    /** team-backend GitHubInstallation.id */
    installationId?: string;
    /** GitHub's numeric installation ID */
    githubInstallationId?: number;
    /** Default branch of the repo */
    defaultBranch?: string;
}

export interface GlobalConfig {
    workspaces: WorkspaceInfo[];
    activeWorkspaceId: string | null;
}

const DEFAULT_CONFIG: GlobalConfig = {
    workspaces: [],
    activeWorkspaceId: null,
};

export class GlobalConfigManager {
    private configDir: string;
    private configPath: string;

    constructor() {
        const home = process.env.HOME || "";
        this.configDir = path.join(home, "Library/Application Support/com.firstloop.nomendex");
        this.configPath = path.join(this.configDir, "config.json");
    }

    async ensureDir(): Promise<void> {
        await mkdir(this.configDir, { recursive: true });
    }

    async load(): Promise<GlobalConfig> {
        try {
            const file = Bun.file(this.configPath);
            if (await file.exists()) {
                const content = await file.text();
                const config = JSON.parse(content) as GlobalConfig;
                // Backfill teamMode for workspaces created before team support
                config.workspaces = config.workspaces.map((w) => ({
                    ...w,
                    teamMode: w.teamMode ?? "solo",
                }));
                return config;
            }
        } catch {
            // File doesn't exist or is invalid, return default
        }
        return { ...DEFAULT_CONFIG };
    }

    async save(config: GlobalConfig): Promise<void> {
        await this.ensureDir();
        await Bun.write(this.configPath, JSON.stringify(config, null, 2));
    }

    async getActiveWorkspace(): Promise<WorkspaceInfo | null> {
        const config = await this.load();
        if (!config.activeWorkspaceId) {
            return null;
        }
        return config.workspaces.find((w) => w.id === config.activeWorkspaceId) || null;
    }

    async setActiveWorkspace(workspaceId: string): Promise<void> {
        const config = await this.load();
        const workspace = config.workspaces.find((w) => w.id === workspaceId);
        if (!workspace) {
            throw new Error(`Workspace not found: ${workspaceId}`);
        }

        // Update last accessed time
        workspace.lastAccessedAt = new Date().toISOString();
        config.activeWorkspaceId = workspaceId;

        await this.save(config);
    }

    async addWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
        const config = await this.load();

        // Check if workspace already exists
        const existing = config.workspaces.find((w) => w.path === workspacePath);
        if (existing) {
            return existing;
        }

        // Create new workspace entry
        const workspace: WorkspaceInfo = {
            id: crypto.randomUUID(),
            path: workspacePath,
            name: path.basename(workspacePath),
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            teamMode: "solo",
        };

        config.workspaces.push(workspace);
        await this.save(config);

        return workspace;
    }

    async removeWorkspace(workspaceId: string): Promise<void> {
        const config = await this.load();

        config.workspaces = config.workspaces.filter((w) => w.id !== workspaceId);

        // If we removed the active workspace, clear it
        if (config.activeWorkspaceId === workspaceId) {
            config.activeWorkspaceId = null;
        }

        await this.save(config);
    }

    async updateWorkspaceName(workspaceId: string, name: string): Promise<void> {
        const config = await this.load();
        const workspace = config.workspaces.find((w) => w.id === workspaceId);
        if (!workspace) {
            throw new Error(`Workspace not found: ${workspaceId}`);
        }

        workspace.name = name;
        await this.save(config);
    }

    async enableTeamMode(params: { workspaceId: string; vaultId: string }): Promise<void> {
        const config = await this.load();
        const workspace = config.workspaces.find((w) => w.id === params.workspaceId);
        if (!workspace) {
            throw new Error(`Workspace not found: ${params.workspaceId}`);
        }

        workspace.teamMode = "team";
        workspace.teamVaultId = params.vaultId;
        await this.save(config);
    }

    async disableTeamMode(params: { workspaceId: string }): Promise<void> {
        const config = await this.load();
        const workspace = config.workspaces.find((w) => w.id === params.workspaceId);
        if (!workspace) {
            throw new Error(`Workspace not found: ${params.workspaceId}`);
        }

        workspace.teamMode = "solo";
        workspace.teamVaultId = undefined;
        await this.save(config);
    }
}

export const globalConfig = new GlobalConfigManager();
