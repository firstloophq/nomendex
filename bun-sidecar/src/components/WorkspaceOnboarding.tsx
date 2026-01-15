import { useState, useEffect, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "./ui/button";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTheme } from "@/hooks/useTheme";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { WorkspaceWarningDialog } from "./WorkspaceWarningDialog";

export function WorkspaceOnboarding() {
    const { addWorkspace } = useWorkspaceSwitcher();
    const { currentTheme } = useTheme();
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

    return (
        <div
            className="flex flex-col items-center justify-center h-screen gap-8 p-8"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            <div className="flex flex-col items-center gap-4 text-center max-w-md">
                <div
                    className="p-4 rounded-full"
                    style={{ backgroundColor: currentTheme.styles.surfaceAccent }}
                >
                    <FolderOpen className="size-12" style={{ color: currentTheme.styles.contentPrimary }} />
                </div>
                <h1 className="text-2xl font-semibold">Welcome to Nomendex</h1>
                <p style={{ color: currentTheme.styles.contentSecondary }}>
                    Choose a folder to use as your workspace. Your todos, notes, and settings will be stored there.
                </p>
            </div>

            <Button onClick={handleChooseFolder} size="lg" className="gap-2">
                <FolderOpen className="size-4" />
                Choose Workspace Folder
            </Button>

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
