import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";

interface DeleteProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    projectName: string;
    onDeleted: () => void;
}

export function DeleteProjectDialog({
    open,
    onOpenChange,
    projectId,
    projectName,
    onDeleted,
}: DeleteProjectDialogProps) {
    const [cascade, setCascade] = useState(false);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<{ todoCount: number; noteCount: number } | null>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const projectsAPI = useProjectsAPI();

    // Load stats when dialog opens
    useEffect(() => {
        if (open && projectName) {
            setStats(null);
            setCascade(false);
            projectsAPI.getProjectStats({ projectName }).then(setStats);
        }
    }, [open, projectName, projectsAPI]);

    const handleDelete = async () => {
        setLoading(true);
        try {
            await projectsAPI.deleteProject({ projectId, cascade });
            onOpenChange(false);
            onDeleted();
        } catch (err) {
            console.error("Failed to delete project:", err);
        } finally {
            setLoading(false);
        }
    };

    const hasAssociatedItems = stats && (stats.todoCount > 0 || stats.noteCount > 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: "450px",
                    maxWidth: "90vw",
                }}
            >
                {/* Content Area */}
                <div className="px-6 pt-6 pb-4 space-y-4">
                    <div className="flex items-start gap-3">
                        <div
                            className="p-2 rounded-full"
                            style={{ backgroundColor: `${styles.semanticDestructive}20` }}
                        >
                            <AlertTriangle
                                size={20}
                                style={{ color: styles.semanticDestructive }}
                            />
                        </div>
                        <div>
                            <h2
                                className="text-lg font-semibold"
                                style={{ color: styles.contentPrimary }}
                            >
                                Delete Project
                            </h2>
                            <p
                                className="text-sm mt-1"
                                style={{ color: styles.contentSecondary }}
                            >
                                Are you sure you want to delete <strong>{projectName}</strong>?
                            </p>
                        </div>
                    </div>

                    {/* Stats */}
                    {stats && hasAssociatedItems && (
                        <div
                            className="p-3 rounded-lg text-sm"
                            style={{
                                backgroundColor: styles.surfaceSecondary,
                                border: `1px solid ${styles.borderDefault}`,
                            }}
                        >
                            <p style={{ color: styles.contentSecondary }}>
                                This project has:
                            </p>
                            <ul className="mt-2 space-y-1" style={{ color: styles.contentPrimary }}>
                                {stats.todoCount > 0 && (
                                    <li>
                                        <strong>{stats.todoCount}</strong> todo{stats.todoCount !== 1 ? "s" : ""}
                                    </li>
                                )}
                                {stats.noteCount > 0 && (
                                    <li>
                                        <strong>{stats.noteCount}</strong> note{stats.noteCount !== 1 ? "s" : ""}
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}

                    {/* Cascade option */}
                    {hasAssociatedItems && (
                        <div className="flex items-start gap-3">
                            <Checkbox
                                id="cascade"
                                checked={cascade}
                                onCheckedChange={(checked) => setCascade(checked === true)}
                            />
                            <div>
                                <label
                                    htmlFor="cascade"
                                    className="text-sm font-medium cursor-pointer"
                                    style={{ color: styles.contentPrimary }}
                                >
                                    Also delete all associated todos and notes
                                </label>
                                <p
                                    className="text-xs mt-0.5"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    {cascade
                                        ? "All todos and notes will be permanently deleted"
                                        : "Todos and notes will keep their project field but won't be linked to this project"}
                                </p>
                            </div>
                        </div>
                    )}

                    {!hasAssociatedItems && stats && (
                        <p
                            className="text-sm"
                            style={{ color: styles.contentSecondary }}
                        >
                            This project has no associated todos or notes.
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div
                    className="px-6 py-3 flex items-center justify-end gap-2"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderTop: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <Button
                        onClick={() => onOpenChange(false)}
                        variant="ghost"
                        size="sm"
                        className="h-9 px-4"
                        autoFocus
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDelete}
                        disabled={loading}
                        variant="destructive"
                        size="sm"
                        className="h-9 px-4"
                    >
                        {loading ? "Deleting..." : cascade ? "Delete All" : "Delete Project"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
