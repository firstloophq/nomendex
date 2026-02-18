import { useState, useEffect, useCallback } from "react";

export type TeamMode = "solo" | "team";

export interface WorkspaceInfo {
    id: string;
    path: string;
    name: string;
    createdAt: string;
    lastAccessedAt: string;
    teamVaultId?: string;
    teamMode: TeamMode;
    orgId?: string;
    orgWorkspaceId?: string;
    repoFullName?: string;
    installationId?: string;
    githubInstallationId?: number;
    defaultBranch?: string;
}

export interface GlobalConfig {
    workspaces: WorkspaceInfo[];
    activeWorkspaceId: string | null;
}

interface UseWorkspaceSwitcherResult {
    workspaces: WorkspaceInfo[];
    activeWorkspace: WorkspaceInfo | null;
    loading: boolean;
    error: string | null;
    switchWorkspace: (workspaceId: string) => Promise<void>;
    addWorkspace: (path: string) => Promise<void>;
    removeWorkspace: (workspaceId: string) => Promise<void>;
    renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
    refresh: () => Promise<void>;
}

export function useWorkspaceSwitcher(): UseWorkspaceSwitcherResult {
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchWorkspaces = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const [configRes, activeRes] = await Promise.all([
                fetch("/api/workspaces"),
                fetch("/api/workspaces/active"),
            ]);

            const configData = await configRes.json();
            const activeData = await activeRes.json();

            if (configData.success) {
                setWorkspaces(configData.data.workspaces || []);
            }

            if (activeData.success) {
                setActiveWorkspace(activeData.data);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load workspaces");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchWorkspaces();
    }, [fetchWorkspaces]);

    const switchWorkspace = useCallback(async (workspaceId: string) => {
        try {
            const res = await fetch("/api/workspaces/switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId }),
            });

            const data = await res.json();

            if (data.success && data.data?.requiresReload) {
                // Reload the page to reinitialize with the new workspace
                window.location.reload();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to switch workspace");
        }
    }, []);

    const addWorkspace = useCallback(async (path: string) => {
        try {
            const res = await fetch("/api/workspaces/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path }),
            });

            const data = await res.json();

            if (data.success) {
                // Switch to the newly added workspace
                await switchWorkspace(data.data.id);
            } else {
                setError(data.message || "Failed to add workspace");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add workspace");
        }
    }, [switchWorkspace]);

    const removeWorkspace = useCallback(async (workspaceId: string) => {
        try {
            const isRemovingActive = workspaceId === activeWorkspace?.id;

            const res = await fetch("/api/workspaces/remove", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId }),
            });

            const data = await res.json();

            if (data.success) {
                if (isRemovingActive) {
                    // Find another workspace to switch to
                    const remainingWorkspaces = workspaces.filter(w => w.id !== workspaceId);

                    if (remainingWorkspaces.length > 0) {
                        // Switch to the first remaining workspace
                        await switchWorkspace(remainingWorkspaces[0].id);
                    } else {
                        // No workspaces left - reload to show onboarding
                        window.location.reload();
                    }
                } else {
                    // Just refresh the list
                    await fetchWorkspaces();
                }
            } else {
                setError(data.message || "Failed to remove workspace");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to remove workspace");
        }
    }, [fetchWorkspaces, activeWorkspace, workspaces, switchWorkspace]);

    const renameWorkspace = useCallback(async (workspaceId: string, name: string) => {
        try {
            const res = await fetch("/api/workspaces/rename", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId, name }),
            });

            const data = await res.json();

            if (data.success) {
                await fetchWorkspaces();
            } else {
                setError(data.message || "Failed to rename workspace");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to rename workspace");
        }
    }, [fetchWorkspaces]);

    return {
        workspaces,
        activeWorkspace,
        loading,
        error,
        switchWorkspace,
        addWorkspace,
        removeWorkspace,
        renameWorkspace,
        refresh: fetchWorkspaces,
    };
}
