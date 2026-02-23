import { useState, useEffect, useCallback } from "react";

export interface WorkspaceInfo {
    id: string;
    path: string;
    name: string;
    createdAt: string;
    lastAccessedAt: string;
    teamVaultId?: string;
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
    appMode?: "solo" | "team";
}

interface UseWorkspaceSwitcherResult {
    workspaces: WorkspaceInfo[];
    activeWorkspace: WorkspaceInfo | null;
    appMode: "solo" | "team" | undefined;
    loading: boolean;
    error: string | null;
    switchWorkspace: (workspaceId: string) => Promise<void>;
    addWorkspace: (path: string) => Promise<void>;
    removeWorkspace: (workspaceId: string) => Promise<void>;
    renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
    setAppMode: (mode: "solo" | "team") => Promise<void>;
    refresh: () => Promise<void>;
}

interface WorkspaceSwitcherCache {
    workspaces: WorkspaceInfo[];
    activeWorkspace: WorkspaceInfo | null;
    appMode: "solo" | "team" | undefined;
    hasResolved: boolean;
}

const workspaceSwitcherCache: WorkspaceSwitcherCache = {
    workspaces: [],
    activeWorkspace: null,
    appMode: undefined,
    hasResolved: false,
};

export function useWorkspaceSwitcher(): UseWorkspaceSwitcherResult {
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(workspaceSwitcherCache.workspaces);
    const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(workspaceSwitcherCache.activeWorkspace);
    const [appMode, setAppModeState] = useState<"solo" | "team" | undefined>(workspaceSwitcherCache.appMode);
    const [loading, setLoading] = useState(!workspaceSwitcherCache.hasResolved);
    const [error, setError] = useState<string | null>(null);

    const syncLocalState = useCallback((next: WorkspaceSwitcherCache) => {
        setWorkspaces(next.workspaces);
        setActiveWorkspace(next.activeWorkspace);
        setAppModeState(next.appMode);
        setLoading(false);
    }, []);

    const fetchWorkspaces = useCallback(async (options?: { background?: boolean }) => {
        try {
            if (!options?.background) {
                setLoading(true);
            }
            setError(null);

            const [configRes, activeRes] = await Promise.all([
                fetch("/api/workspaces"),
                fetch("/api/workspaces/active"),
            ]);

            const configData = await configRes.json();
            const activeData = await activeRes.json();

            const resolvedWorkspaces: WorkspaceInfo[] = configData.success
                ? (configData.data.workspaces || [])
                : workspaceSwitcherCache.workspaces;
            const resolvedAppMode: "solo" | "team" | undefined = configData.success
                ? configData.data.appMode
                : workspaceSwitcherCache.appMode;

            let resolvedActiveWorkspace: WorkspaceInfo | null = null;
            if (activeData.success) {
                resolvedActiveWorkspace = activeData.data ?? null;
            }

            if (!resolvedActiveWorkspace && configData.success) {
                const activeWorkspaceId = configData.data.activeWorkspaceId;
                if (activeWorkspaceId) {
                    resolvedActiveWorkspace = resolvedWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
                }
            }

            if (!resolvedActiveWorkspace) {
                resolvedActiveWorkspace = workspaceSwitcherCache.activeWorkspace;
            }

            const nextCache: WorkspaceSwitcherCache = {
                workspaces: resolvedWorkspaces,
                activeWorkspace: resolvedActiveWorkspace,
                appMode: resolvedAppMode,
                hasResolved: true,
            };
            workspaceSwitcherCache.workspaces = nextCache.workspaces;
            workspaceSwitcherCache.activeWorkspace = nextCache.activeWorkspace;
            workspaceSwitcherCache.appMode = nextCache.appMode;
            workspaceSwitcherCache.hasResolved = true;
            syncLocalState(nextCache);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load workspaces");
            setLoading(false);
        } finally {
            if (!options?.background) {
                setLoading(false);
            }
        }
    }, [syncLocalState]);

    useEffect(() => {
        if (workspaceSwitcherCache.hasResolved) {
            syncLocalState(workspaceSwitcherCache);
            void fetchWorkspaces({ background: true });
            return;
        }
        void fetchWorkspaces();
    }, [fetchWorkspaces, syncLocalState]);

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

    const setAppMode = useCallback(async (mode: "solo" | "team") => {
        try {
            const res = await fetch("/api/workspaces/set-app-mode", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode }),
            });

            const data = await res.json();

            if (data.success && data.data?.requiresReload) {
                window.location.reload();
            } else if (!data.success) {
                setError(data.message || "Failed to set app mode");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to set app mode");
        }
    }, []);

    return {
        workspaces,
        activeWorkspace,
        appMode,
        loading,
        error,
        switchWorkspace,
        addWorkspace,
        removeWorkspace,
        renameWorkspace,
        setAppMode,
        refresh: fetchWorkspaces,
    };
}
