import { useState, useEffect, useCallback, useMemo } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { FolderOpen, Plus, ChevronDown, Check, Settings, Github } from "lucide-react";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTheme } from "@/hooks/useTheme";
import { useTeamAuth } from "@/contexts/AuthContext";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { WorkspaceManager } from "./WorkspaceManager";
import { WorkspaceWarningDialog } from "./WorkspaceWarningDialog";
import { GitHubRepoPickerDialog } from "./GitHubRepoPickerDialog";

export function WorkspaceSwitcher() {
    const { workspaces, activeWorkspace, appMode, loading, switchWorkspace, addWorkspace } =
        useWorkspaceSwitcher();
    const { currentTheme } = useTheme();
    const { isSignedIn } = useTeamAuth();
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const [managerOpen, setManagerOpen] = useState(false);
    const [warningDialogOpen, setWarningDialogOpen] = useState(false);
    const [pendingPath, setPendingPath] = useState<string | null>(null);
    const [gitHubPickerOpen, setGitHubPickerOpen] = useState(false);

    // Split workspaces into solo and team
    const { soloWorkspaces, teamWorkspaces } = useMemo(() => {
        const solo = workspaces.filter((ws) => !ws.repoFullName);
        const team = workspaces.filter((ws) => !!ws.repoFullName);
        return { soloWorkspaces: solo, teamWorkspaces: team };
    }, [workspaces]);

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

    const handleAddWorkspace = () => {
        if (isNativeApp) {
            // Use native folder picker in macOS app
            const webkit = window.webkit as { messageHandlers?: { chooseDataRoot?: { postMessage: (data: Record<string, never>) => void } } } | undefined;
            webkit?.messageHandlers?.chooseDataRoot?.postMessage({});
        } else {
            // Use web-based folder picker in browser/dev mode
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

    if (loading) {
        return (
            <div
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md opacity-50"
                style={{ color: currentTheme.styles.contentSecondary }}
            >
                <FolderOpen className="size-4" />
                <span className="text-sm">Loading...</span>
            </div>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{
                    color: currentTheme.styles.contentPrimary,
                    backgroundColor: "transparent",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                }}
            >
                {activeWorkspace?.repoFullName ? (
                    <Github className="size-4 shrink-0" />
                ) : (
                    <FolderOpen className="size-4 shrink-0" />
                )}
                <span className="truncate flex-1 text-left text-sm">
                    {activeWorkspace?.name || "No Workspace"}
                </span>
                <ChevronDown className="size-3 opacity-50 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="w-56"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                {/* Solo workspaces — hidden in team mode */}
                {appMode !== "team" && soloWorkspaces.map((ws) => (
                    <DropdownMenuItem
                        key={ws.id}
                        onClick={() => switchWorkspace(ws.id)}
                        className="cursor-pointer"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        <FolderOpen className="size-4 mr-2 shrink-0" />
                        <span className="truncate flex-1">{ws.name}</span>
                        {ws.id === activeWorkspace?.id && (
                            <Check className="size-4 ml-2 shrink-0" />
                        )}
                    </DropdownMenuItem>
                ))}

                {/* Team workspaces — hidden in solo mode */}
                {appMode === "team" && teamWorkspaces.length > 0 && (
                    <>
                        {teamWorkspaces.map((ws) => (
                            <DropdownMenuItem
                                key={ws.id}
                                onClick={() => switchWorkspace(ws.id)}
                                className="cursor-pointer"
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <Github className="size-4 mr-2 shrink-0" />
                                <span className="truncate flex-1">{ws.name}</span>
                                {ws.id === activeWorkspace?.id && (
                                    <Check className="size-4 ml-2 shrink-0" />
                                )}
                            </DropdownMenuItem>
                        ))}
                    </>
                )}

                <DropdownMenuSeparator />
                {/* Add local workspace — only in solo mode */}
                {appMode !== "team" && (
                    <DropdownMenuItem
                        onClick={handleAddWorkspace}
                        className="cursor-pointer"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        <Plus className="size-4 mr-2 shrink-0" />
                        <span>Add Workspace...</span>
                    </DropdownMenuItem>
                )}
                {/* Create from GitHub — only in team mode when signed in */}
                {appMode === "team" && isSignedIn && (
                    <DropdownMenuItem
                        onClick={() => setGitHubPickerOpen(true)}
                        className="cursor-pointer"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        <Github className="size-4 mr-2 shrink-0" />
                        <span>Create from GitHub...</span>
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem
                    onClick={() => setManagerOpen(true)}
                    className="cursor-pointer"
                    style={{ color: currentTheme.styles.contentPrimary }}
                >
                    <Settings className="size-4 mr-2 shrink-0" />
                    <span>Manage Workspaces...</span>
                </DropdownMenuItem>
            </DropdownMenuContent>

            <WorkspaceManager
                open={managerOpen}
                onOpenChange={setManagerOpen}
            />

            <FolderPickerDialog
                open={folderPickerOpen}
                onOpenChange={setFolderPickerOpen}
                onSelect={handleFolderSelect}
                title="Add Workspace"
                description="Select a folder to add as a new workspace."
            />

            <WorkspaceWarningDialog
                open={warningDialogOpen}
                onOpenChange={setWarningDialogOpen}
                onConfirm={handleWarningConfirm}
                selectedPath={pendingPath || ""}
            />

            <GitHubRepoPickerDialog
                open={gitHubPickerOpen}
                onOpenChange={setGitHubPickerOpen}
            />
        </DropdownMenu>
    );
}
