import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGHSync } from "@/contexts/GHSyncContext";
import { useEnvConfig } from "@/hooks/useEnvConfig";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GitBranch, Key, CheckCircle2, XCircle, ExternalLink, Download } from "lucide-react";

export function GHSyncSetupPrompt() {
    const navigate = useNavigate();
    const { setupStatus, needsSetup } = useGHSync();
    const { config } = useEnvConfig();
    const [dismissed, setDismissed] = useState(false);
    const [open, setOpen] = useState(false);

    // Show dialog when setup is needed, not dismissed, and warnings are not suppressed
    useEffect(() => {
        if (setupStatus.checked && needsSetup && !dismissed && !config?.suppressWarnings) {
            // Small delay to not show immediately on app load
            const timer = setTimeout(() => setOpen(true), 500);
            return () => clearTimeout(timer);
        } else {
            setOpen(false);
        }
    }, [setupStatus.checked, needsSetup, dismissed, config?.suppressWarnings]);

    const handleSetup = () => {
        setOpen(false);
        navigate("/sync");
    };

    const handleDismiss = () => {
        setDismissed(true);
        setOpen(false);
    };

    if (!setupStatus.checked) return null;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <GitBranch className="h-5 w-5" />
                        Set Up Sync
                    </DialogTitle>
                    <DialogDescription>
                        Configure GitHub sync to back up and sync your workspace across devices.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-4">
                    {/* Git Installed Status */}
                    <div className="flex items-center gap-3 text-sm">
                        {setupStatus.gitInstalled ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className={setupStatus.gitInstalled ? "text-foreground" : "text-muted-foreground"}>
                            Git installed
                        </span>
                    </div>

                    {!setupStatus.gitInstalled && (
                        <div className="pl-7">
                            <a
                                href="https://git-scm.com/downloads/mac"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                            >
                                <Download className="h-3 w-3" />
                                Install Git for macOS
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                    )}

                    {/* Git Repository Status - only show if git is installed */}
                    {setupStatus.gitInstalled && (
                        <div className="flex items-center gap-3 text-sm">
                            {setupStatus.gitInitialized && setupStatus.hasRemote ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                            ) : (
                                <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            )}
                            <span className={setupStatus.gitInitialized && setupStatus.hasRemote ? "text-foreground" : "text-muted-foreground"}>
                                Git repository connected
                            </span>
                        </div>
                    )}

                    {/* PAT Status - only show if git is installed */}
                    {setupStatus.gitInstalled && (
                        <>
                            <div className="flex items-center gap-3 text-sm">
                                {setupStatus.hasPAT ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                ) : (
                                    <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                )}
                                <span className={setupStatus.hasPAT ? "text-foreground" : "text-muted-foreground"}>
                                    GitHub Personal Access Token
                                </span>
                            </div>

                            {!setupStatus.hasPAT && (
                                <p className="text-xs text-muted-foreground pl-7">
                                    Create a PAT at github.com/settings/tokens with 'repo' scope
                                </p>
                            )}
                        </>
                    )}
                </div>

                <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={handleDismiss}>
                        Later
                    </Button>
                    <Button onClick={handleSetup}>
                        <Key className="h-4 w-4 mr-2" />
                        Set Up Now
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
