import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { useTheme } from "@/hooks/useTheme";
import { AlertTriangle } from "lucide-react";

interface WorkspaceWarningDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    selectedPath: string;
}

export function WorkspaceWarningDialog({
    open,
    onOpenChange,
    onConfirm,
    selectedPath,
}: WorkspaceWarningDialogProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Amber/warning color since theme doesn't have semanticWarning
    const warningColor = "#f59e0b";

    const [acceptsRisks, setAcceptsRisks] = useState(false);
    const [hasBackedUp, setHasBackedUp] = useState(false);

    const canContinue = acceptsRisks && hasBackedUp;

    const handleConfirm = () => {
        if (canContinue) {
            onConfirm();
            // Reset checkboxes for next time
            setAcceptsRisks(false);
            setHasBackedUp(false);
        }
    };

    const handleCancel = () => {
        onOpenChange(false);
        // Reset checkboxes
        setAcceptsRisks(false);
        setHasBackedUp(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div
                            className="p-2 rounded-full"
                            style={{ backgroundColor: warningColor + "20" }}
                        >
                            <AlertTriangle
                                className="size-5"
                                style={{ color: warningColor }}
                            />
                        </div>
                        <DialogTitle>Welcome to the Nomendex Alpha!</DialogTitle>
                    </div>
                    <DialogDescription className="sr-only">
                        Welcome to the Nomendex Alpha with backup recommendations
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    {/* Alpha Warning */}
                    <div
                        className="p-3 rounded-md text-sm"
                        style={{
                            backgroundColor: warningColor + "10",
                            border: `1px solid ${warningColor}30`,
                        }}
                    >
                        <p style={{ color: styles.contentPrimary }}>
                            <strong>This is an Alpha Release.</strong> Please expect bugs. Please
                            backup your Vault or Repo before continuing.
                        </p>
                    </div>

                    {/* Obsidian Compatibility Warning */}
                    <div
                        className="p-3 rounded-md text-sm"
                        style={{
                            backgroundColor: styles.surfaceSecondary,
                            border: `1px solid ${styles.borderDefault}`,
                        }}
                    >
                        <p style={{ color: styles.contentPrimary }}>
                            <strong>Obsidian Compatibility:</strong> Nomendex strives to not break
                            Obsidian vaults, but there is significantly more testing that needs to
                            be done. If you are connecting Nomendex to an Obsidian vault please back
                            up the vault first, or make a copy of it and connect to the copy
                            instead.
                        </p>
                    </div>

                    {/* Selected Path */}
                    <div className="text-sm" style={{ color: styles.contentSecondary }}>
                        Selected folder:{" "}
                        <span
                            className="font-mono text-xs"
                            style={{ color: styles.contentPrimary }}
                        >
                            {selectedPath}
                        </span>
                    </div>

                    {/* Checkboxes */}
                    <div className="flex flex-col gap-3 pt-2">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <Checkbox
                                checked={acceptsRisks}
                                onCheckedChange={(checked) =>
                                    setAcceptsRisks(checked === true)
                                }
                                className="mt-0.5"
                            />
                            <span
                                className="text-sm leading-tight"
                                style={{ color: styles.contentPrimary }}
                            >
                                I understand this is an alpha version and am okay with the risks
                            </span>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer">
                            <Checkbox
                                checked={hasBackedUp}
                                onCheckedChange={(checked) => setHasBackedUp(checked === true)}
                                className="mt-0.5"
                            />
                            <span
                                className="text-sm leading-tight"
                                style={{ color: styles.contentPrimary }}
                            >
                                I have backed up my vault before connecting Nomendex to it
                            </span>
                        </label>
                    </div>
                </div>

                <DialogFooter className="pt-2">
                    <Button variant="ghost" onClick={handleCancel} autoFocus>
                        Cancel
                    </Button>
                    <div className="flex flex-col items-center">
                        <Button onClick={handleConfirm} disabled={!canContinue}>
                            Continue
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
