import { useState, useEffect, useCallback } from "react";
import { FolderOpen, Github, LogIn, LogOut, Loader2, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTeamAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { WorkspaceWarningDialog } from "./WorkspaceWarningDialog";
import { GitHubRepoPickerDialog } from "./GitHubRepoPickerDialog";
import { getTeamBackendHttpUrl } from "@/lib/team-backend-config";

interface OrgWorkspace {
    id: string;
    orgId: string;
    installationId: string;
    repoFullName: string;
    displayName: string;
    defaultBranch: string;
}

interface Org {
    id: string;
    name: string;
}

/**
 * Shows the user's org workspaces when signed in.
 * Lets them clone an existing workspace or add a new one from GitHub.
 */
function SignedInOnboarding(props: { currentTheme: ReturnType<typeof useTheme>["currentTheme"] }) {
    const { currentTheme } = props;
    const { getToken } = useTeamAuth();
    const [_orgs, setOrgs] = useState<Org[]>([]);
    const [orgWorkspaces, setOrgWorkspaces] = useState<OrgWorkspace[]>([]);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [gitHubPickerOpen, setGitHubPickerOpen] = useState(false);

    const fetchWithAuth = useCallback(async (path: string, options?: RequestInit) => {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");
        const teamBackendUrl = await getTeamBackendHttpUrl();
        return fetch(`${teamBackendUrl}${path}`, {
            ...options,
            headers: {
                ...options?.headers,
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
    }, [getToken]);

    // Fetch orgs and their workspaces
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const orgsRes = await fetchWithAuth("/api/orgs");
                if (!orgsRes.ok) throw new Error("Failed to fetch orgs");
                const orgsData = (await orgsRes.json()) as Org[];
                if (cancelled) return;
                setOrgs(orgsData);

                // Fetch workspaces for each org
                const allWorkspaces: OrgWorkspace[] = [];
                for (const org of orgsData) {
                    const wsRes = await fetchWithAuth(`/api/orgs/${org.id}/workspaces`);
                    if (wsRes.ok) {
                        const wsData = (await wsRes.json()) as OrgWorkspace[];
                        allWorkspaces.push(...wsData);
                    }
                }
                if (cancelled) return;
                setOrgWorkspaces(allWorkspaces);
            } catch {
                if (!cancelled) setError("Failed to load workspaces");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [fetchWithAuth]);

    const handleJoinWorkspace = async (ws: OrgWorkspace) => {
        setJoining(ws.id);
        setError(null);
        try {
            // Get installation token
            const tokenRes = await fetchWithAuth(
                `/api/github/installations/${ws.installationId}/token`,
                { method: "POST" },
            );
            if (!tokenRes.ok) throw new Error("Failed to get installation token");
            const { token: authToken } = (await tokenRes.json()) as { token: string };

            // Clone locally
            const cloneRes = await fetch("/api/workspaces/create-from-github", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    repoFullName: ws.repoFullName,
                    displayName: ws.displayName || ws.repoFullName,
                    orgId: ws.orgId,
                    orgWorkspaceId: ws.id,
                    installationId: ws.installationId,
                    githubInstallationId: 0,
                    defaultBranch: ws.defaultBranch || "main",
                    authToken,
                }),
            });

            const cloneData = (await cloneRes.json()) as { success: boolean; message?: string };
            if (!cloneData.success) {
                throw new Error(cloneData.message || "Failed to clone workspace");
            }

            window.location.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to join workspace");
        } finally {
            setJoining(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center gap-4 w-full max-w-md">
                <Loader2 className="size-6 animate-spin" style={{ color: currentTheme.styles.contentSecondary }} />
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center gap-6 w-full max-w-md">
            {error && (
                <div
                    className="text-sm p-3 rounded-md border w-full"
                    style={{
                        color: currentTheme.styles.semanticDestructive,
                        borderColor: currentTheme.styles.semanticDestructive,
                        backgroundColor: `${currentTheme.styles.semanticDestructive}10`,
                    }}
                >
                    {error}
                </div>
            )}

            {orgWorkspaces.length > 0 ? (
                <>
                    <div className="w-full">
                        <h2 className="text-lg font-semibold mb-1">Your Workspaces</h2>
                        <p className="text-sm mb-4" style={{ color: currentTheme.styles.contentSecondary }}>
                            Select a workspace to get started
                        </p>
                        <div className="space-y-2">
                            {orgWorkspaces.map((ws) => (
                                <button
                                    key={ws.id}
                                    onClick={() => handleJoinWorkspace(ws)}
                                    disabled={joining !== null}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left focus:outline-none focus:ring-2 focus:ring-offset-1"
                                    style={{
                                        borderColor: currentTheme.styles.borderDefault,
                                        backgroundColor: currentTheme.styles.surfaceSecondary,
                                    }}
                                >
                                    <Github className="size-5 shrink-0" style={{ color: currentTheme.styles.contentSecondary }} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {ws.displayName || ws.repoFullName}
                                        </p>
                                        <p className="text-xs truncate" style={{ color: currentTheme.styles.contentTertiary }}>
                                            {ws.repoFullName}
                                        </p>
                                    </div>
                                    {joining === ws.id && (
                                        <Loader2 className="size-4 animate-spin shrink-0" style={{ color: currentTheme.styles.contentSecondary }} />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Button
                        onClick={() => setGitHubPickerOpen(true)}
                        variant="outline"
                        className="gap-2"
                    >
                        <Plus className="size-4" />
                        Add Workspace from GitHub
                    </Button>
                </>
            ) : (
                <>
                    <p style={{ color: currentTheme.styles.contentSecondary }}>
                        No team workspaces yet. Add a repository from GitHub to get started.
                    </p>
                    <Button
                        onClick={() => setGitHubPickerOpen(true)}
                        size="lg"
                        className="gap-2"
                    >
                        <Github className="size-4" />
                        Add Workspace from GitHub
                    </Button>
                </>
            )}

            <GitHubRepoPickerDialog
                open={gitHubPickerOpen}
                onOpenChange={setGitHubPickerOpen}
            />
        </div>
    );
}

export function WorkspaceOnboarding() {
    const { addWorkspace } = useWorkspaceSwitcher();
    const { currentTheme } = useTheme();
    const { isSignedIn, userName, userImageUrl, signIn, signOut } = useTeamAuth();
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const [warningDialogOpen, setWarningDialogOpen] = useState(false);
    const [pendingPath, setPendingPath] = useState<string | null>(null);

    // Check if we're running in native macOS app
    const isNativeApp = Boolean(
        (window as Window & { webkit?: { messageHandlers?: { chooseDataRoot?: unknown } } }).webkit?.messageHandlers?.chooseDataRoot
    );

    // Set up callback for native folder picker
    const handleSetDataRoot = useCallback(
        (path: string) => {
            setPendingPath(path);
            setWarningDialogOpen(true);
        },
        []
    );

    useEffect(() => {
        (window as Window & { __setDataRoot?: (path: string) => void }).__setDataRoot = handleSetDataRoot;
        return () => {
            delete (window as Window & { __setDataRoot?: (path: string) => void }).__setDataRoot;
        };
    }, [handleSetDataRoot]);

    const handleChooseFolder = () => {
        if (isNativeApp) {
            const webkit = window.webkit as { messageHandlers?: { chooseDataRoot?: { postMessage: (data: Record<string, never>) => void } } } | undefined;
            webkit?.messageHandlers?.chooseDataRoot?.postMessage({});
        } else {
            setFolderPickerOpen(true);
        }
    };

    const handleFolderSelect = (path: string) => {
        setPendingPath(path);
        setWarningDialogOpen(true);
    };

    const handleWarningConfirm = () => {
        if (pendingPath) {
            addWorkspace(pendingPath);
            setPendingPath(null);
        }
        setWarningDialogOpen(false);
    };

    return (
        <div
            className="flex flex-col items-center justify-center h-screen gap-8 p-8"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            {/* Sign-in area in top-right */}
            <div className="absolute top-4 right-4">
                {!isSignedIn ? (
                    <button
                        onClick={() => signIn()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors hover:opacity-80"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    >
                        <LogIn className="size-3.5" />
                        Sign In
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        {userImageUrl && (
                            <img src={userImageUrl} alt="" className="size-6 rounded-full" />
                        )}
                        <span className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                            {userName}
                        </span>
                        <button
                            onClick={() => signOut()}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:opacity-80"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            <LogOut className="size-3" />
                        </button>
                    </div>
                )}
            </div>

            <div className="flex flex-col items-center gap-4 text-center max-w-md">
                <h1 className="text-2xl font-semibold">Welcome to Nomendex</h1>
            </div>

            {/* Signed in: show org workspaces */}
            {isSignedIn && (
                <SignedInOnboarding currentTheme={currentTheme} />
            )}

            {/* Signed out: show folder picker */}
            {!isSignedIn && (
                <>
                    <div className="flex flex-col items-center gap-4 text-center max-w-md">
                        <div
                            className="p-4 rounded-full"
                            style={{ backgroundColor: currentTheme.styles.surfaceAccent }}
                        >
                            <FolderOpen className="size-12" style={{ color: currentTheme.styles.contentPrimary }} />
                        </div>
                        <p style={{ color: currentTheme.styles.contentSecondary }}>
                            Choose a folder to use as your workspace. Your todos, notes, and settings will be stored there.
                        </p>
                    </div>

                    <Button onClick={handleChooseFolder} size="lg" className="gap-2">
                        <FolderOpen className="size-4" />
                        Choose Workspace Folder
                    </Button>
                </>
            )}

            <p
                className="text-sm text-center max-w-sm"
                style={{ color: currentTheme.styles.contentTertiary }}
            >
                You can add more workspaces later and switch between them from the sidebar.
            </p>

            <FolderPickerDialog
                open={folderPickerOpen}
                onOpenChange={setFolderPickerOpen}
                onSelect={handleFolderSelect}
                title="Choose Workspace Folder"
                description="Select a folder to use as your workspace. Your todos, notes, and settings will be stored there."
            />

            <WorkspaceWarningDialog
                open={warningDialogOpen}
                onOpenChange={setWarningDialogOpen}
                onConfirm={handleWarningConfirm}
                selectedPath={pendingPath || ""}
            />
        </div>
    );
}
