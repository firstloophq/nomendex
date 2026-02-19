import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, type Editor } from "tldraw";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useCanvasAPI } from "@/hooks/useCanvasAPI";
import { useTheme } from "@/hooks/useTheme";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCanvasCRDT } from "./useCanvasCRDT";
import type { CanvasItem } from "./index";

interface CanvasEditorViewProps {
    canvasId: string;
    tabId: string;
}

const TITLE_SAVE_DEBOUNCE_MS = 300;

export function CanvasEditorView(props: CanvasEditorViewProps) {
    const { canvasId, tabId } = props;
    const { setTabName, activeTab } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const canvasAPI = useCanvasAPI();

    const [canvas, setCanvas] = useState<CanvasItem | null>(null);
    const [title, setTitle] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const saveTitleTimerRef = useRef<number | null>(null);
    const lastSavedTitleRef = useRef<string>("");

    const { handleMount, isConnected, isSynced, collabEnabled } = useCanvasCRDT({ canvasId });

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                setLoading(true);
                setError(null);
                const result = await canvasAPI.getCanvas({ canvasId });
                if (cancelled) return;
                setCanvas(result);
                setTitle(result.title);
                lastSavedTitleRef.current = result.title;
            } catch (loadError) {
                if (cancelled) return;
                setError(loadError instanceof Error ? loadError.message : "Failed to load canvas");
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canvasAPI, canvasId]);

    useEffect(() => {
        if (!canvas) return;
        if (activeTab?.id !== tabId) return;
        setTabName(tabId, canvas.title);
    }, [activeTab?.id, canvas, setTabName, tabId]);

    const persistTitle = useCallback(async (nextTitle: string) => {
        const trimmed = nextTitle.trim();
        if (!trimmed) return;
        if (trimmed === lastSavedTitleRef.current) return;
        try {
            const updated = await canvasAPI.updateCanvas({
                canvasId,
                updates: { title: trimmed },
            });
            setCanvas(updated);
            lastSavedTitleRef.current = updated.title;
            if (activeTab?.id === tabId) {
                setTabName(tabId, updated.title);
            }
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Failed to save canvas title");
        }
    }, [activeTab?.id, canvasAPI, canvasId, setTabName, tabId]);

    useEffect(() => {
        if (loading) return;
        if (saveTitleTimerRef.current !== null) {
            clearTimeout(saveTitleTimerRef.current);
        }
        saveTitleTimerRef.current = setTimeout(() => {
            saveTitleTimerRef.current = null;
            void persistTitle(title);
        }, TITLE_SAVE_DEBOUNCE_MS) as unknown as number;
        return () => {
            if (saveTitleTimerRef.current !== null) {
                clearTimeout(saveTitleTimerRef.current);
                saveTitleTimerRef.current = null;
            }
        };
    }, [loading, persistTitle, title]);

    const onMount = useCallback((editor: Editor) => {
        handleMount(editor);
    }, [handleMount]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading canvas...</div>
            </div>
        );
    }

    if (error || !canvas) {
        return (
            <div className="h-full p-4">
                <Alert variant="destructive">
                    <AlertDescription>{error ?? "Canvas not found"}</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            <div
                className="px-4 py-3 border-b flex items-center gap-3"
                style={{ borderColor: currentTheme.styles.borderDefault }}
            >
                <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => {
                        void persistTitle(title);
                    }}
                    placeholder="Canvas title"
                    className="max-w-md"
                />
                <div className="flex items-center gap-2 ml-auto text-xs">
                    <span
                        className={`px-2 py-1 rounded ${isConnected
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                            }`}
                    >
                        {collabEnabled ? (isConnected ? "Connected" : "Offline") : "Local"}
                    </span>
                    {collabEnabled && !isSynced && (
                        <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-800">
                            Syncing...
                        </span>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0">
                <Tldraw onMount={onMount} />
            </div>
        </div>
    );
}
