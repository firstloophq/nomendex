import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CreateProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreateProject: (name: string) => Promise<void>;
    loading: boolean;
    existingProjects: string[];
}

export function CreateProjectDialog({
    open,
    onOpenChange,
    onCreateProject,
    loading,
    existingProjects
}: CreateProjectDialogProps) {
    const [projectName, setProjectName] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Reset input when dialog opens
    useEffect(() => {
        if (open) {
            setProjectName("");
            // Focus input after a short delay to allow dialog to render
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const handleCreate = async () => {
        const trimmed = projectName.trim();
        if (trimmed && !loading) {
            await onCreateProject(trimmed);
            onOpenChange(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && projectName.trim()) {
            e.preventDefault();
            handleCreate();
        }
    };

    const isDuplicate = existingProjects.some(p => p.toLowerCase() === projectName.trim().toLowerCase());
    const isValid = projectName.trim().length > 0 && !isDuplicate;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant="default"
                    size="sm"
                    className="h-8 hover:opacity-90 transition-opacity"
                >
                    <Plus className="mr-2 h-4 w-4" />
                    New Project
                </Button>
            </DialogTrigger>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: '400px',
                    maxWidth: '90vw',
                }}
            >
                {/* Content Area */}
                <div className="px-6 pt-6 pb-4 space-y-4">
                    <h2
                        className="text-lg font-semibold"
                        style={{ color: styles.contentPrimary }}
                    >
                        Create Project
                    </h2>

                    <div className="space-y-2">
                        <Input
                            ref={inputRef}
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            placeholder="Project name"
                            className="text-base"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                borderColor: isDuplicate ? styles.semanticDestructive : styles.borderDefault,
                            }}
                            onKeyDown={handleKeyDown}
                        />
                        {isDuplicate && (
                            <p className="text-xs" style={{ color: styles.semanticDestructive }}>
                                A project with this name already exists
                            </p>
                        )}
                    </div>
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
                    >
                        Cancel
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                onClick={handleCreate}
                                disabled={!isValid || loading}
                                size="sm"
                                className="h-9 px-4"
                            >
                                {loading ? "Creating..." : "Create"}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent
                            className="z-[100]"
                            style={{
                                backgroundColor: styles.surfaceTertiary,
                                color: styles.contentPrimary,
                                border: `1px solid ${styles.borderDefault}`,
                            }}
                        >
                            <KeyboardIndicator keys={["enter"]} />
                        </TooltipContent>
                    </Tooltip>
                </div>
            </DialogContent>
        </Dialog>
    );
}
