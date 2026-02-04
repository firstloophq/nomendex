import { useState, useEffect, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { Settings2, FolderOpen, CalendarDays, Check } from "lucide-react";
import type { CaptureSettings, CaptureDestination } from "./capture-types";

interface QuickCaptureDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function QuickCaptureDialog({ open, onOpenChange }: QuickCaptureDialogProps) {
    const { currentTheme } = useTheme();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<CaptureSettings>({
        destination: "folder",
        captureFolder: "Captures",
    });
    const [showSettings, setShowSettings] = useState(false);
    const [saved, setSaved] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Load settings when dialog opens
    useEffect(() => {
        if (open) {
            fetch("/api/captures/settings")
                .then((res) => res.json())
                .then((data) => setSettings(data))
                .catch(console.error);

            // Focus textarea after a brief delay to ensure dialog is rendered
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 50);
        } else {
            // Reset state when closing
            setContent("");
            setShowSettings(false);
            setSaved(false);
        }
    }, [open]);

    const handleSubmit = async () => {
        if (!content.trim() || loading) return;

        setLoading(true);
        try {
            await fetch("/api/captures/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: content.trim() }),
            });
            setSaved(true);
            setTimeout(() => {
                onOpenChange(false);
            }, 300);
        } catch (error) {
            console.error("Failed to save capture:", error);
        } finally {
            setLoading(false);
        }
    };

    // Handle Cmd+Enter to save
    useNativeSubmit(() => {
        if (open && content.trim() && !loading) {
            handleSubmit();
        }
    });

    const handleDestinationChange = async (destination: CaptureDestination) => {
        const newSettings = { ...settings, destination };
        setSettings(newSettings);
        try {
            await fetch("/api/captures/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newSettings),
            });
        } catch (error) {
            console.error("Failed to save settings:", error);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                size="md"
                showCloseButton={false}
                className="gap-3"
            >
                <DialogHeader className="pb-0">
                    <DialogTitle className="flex items-center justify-between">
                        <span>Quick Capture</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setShowSettings(!showSettings)}
                        >
                            <Settings2 className="h-4 w-4" />
                        </Button>
                    </DialogTitle>
                </DialogHeader>

                {showSettings && (
                    <div
                        className="flex gap-2 p-2 rounded-md"
                        style={{ backgroundColor: currentTheme.styles.surfaceTertiary }}
                    >
                        <Button
                            variant={settings.destination === "folder" ? "default" : "ghost"}
                            size="sm"
                            className="flex-1 justify-start gap-2"
                            onClick={() => handleDestinationChange("folder")}
                        >
                            <FolderOpen className="h-4 w-4" />
                            <span className="flex-1 text-left">Captures folder</span>
                            {settings.destination === "folder" && (
                                <Check className="h-4 w-4" />
                            )}
                        </Button>
                        <Button
                            variant={settings.destination === "daily" ? "default" : "ghost"}
                            size="sm"
                            className="flex-1 justify-start gap-2"
                            onClick={() => handleDestinationChange("daily")}
                        >
                            <CalendarDays className="h-4 w-4" />
                            <span className="flex-1 text-left">Daily note</span>
                            {settings.destination === "daily" && (
                                <Check className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                )}

                <Textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="What's on your mind?"
                    className="min-h-[120px] resize-none"
                    autoFocus
                />

                <div className="flex items-center justify-between">
                    <span
                        className="text-xs"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        {settings.destination === "folder"
                            ? `Saving to ${settings.captureFolder}/`
                            : "Appending to daily note"}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenChange(false)}
                            autoFocus={false}
                        >
                            Cancel
                        </Button>
                        <div className="flex flex-col items-center">
                            <Button
                                size="sm"
                                onClick={handleSubmit}
                                disabled={!content.trim() || loading}
                            >
                                {saved ? (
                                    <>
                                        <Check className="h-4 w-4 mr-1" />
                                        Saved
                                    </>
                                ) : loading ? (
                                    "Saving..."
                                ) : (
                                    "Save"
                                )}
                            </Button>
                            <span
                                className="text-[10px] mt-1"
                                style={{ color: currentTheme.styles.contentTertiary }}
                            >
                                ⌘ Enter
                            </span>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
