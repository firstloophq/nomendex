import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Tldraw, type Editor } from "tldraw";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { useCanvasAPI } from "@/hooks/useCanvasAPI";
import { useCanvasCRDT } from "@/features/canvas/useCanvasCRDT";

const DEFAULT_TITLE = "Canvas Persistence Test";
const DEFAULT_MARKER = "persisted-marker";

function sanitizeQueryValue(value: string | null, fallback: string): string {
    if (!value) return fallback;
    const cleaned = value
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 120);
    return cleaned || fallback;
}

function markerTextFromShape(shape: unknown): string | null {
    if (!shape || typeof shape !== "object") return null;
    const meta = (shape as { meta?: { marker?: unknown } }).meta;
    if (meta && typeof meta.marker === "string" && meta.marker.trim().length > 0) {
        return meta.marker;
    }
    const props = (shape as { props?: { text?: unknown } }).props;
    if (!props) return null;
    return typeof props.text === "string" ? props.text : null;
}

export function CanvasTestPage() {
    const location = useLocation();
    const { currentTheme } = useTheme();
    const canvasAPI = useCanvasAPI();

    const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const requestedCanvasId = sanitizeQueryValue(query.get("canvasId"), "");
    const marker = sanitizeQueryValue(query.get("marker"), DEFAULT_MARKER);
    const title = sanitizeQueryValue(query.get("title"), DEFAULT_TITLE);

    const [canvasId, setCanvasId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [shapeCount, setShapeCount] = useState(0);
    const [shapeTexts, setShapeTexts] = useState("");
    const [editor, setEditor] = useState<Editor | null>(null);
    const [editorReady, setEditorReady] = useState(false);
    const [lastAction, setLastAction] = useState("idle");
    const editorRef = useRef<Editor | null>(null);

    const resolvedCanvasId = canvasId ?? "__canvas-test-pending__";
    const { handleMount, isSynced, collabEnabled } = useCanvasCRDT({
        canvasId: resolvedCanvasId,
        forceLocal: true,
    });

    const refreshShapeSummary = useCallback(() => {
        const ed = editorRef.current;
        if (!ed) {
            setShapeCount(0);
            setShapeTexts("");
            return;
        }

        const shapes = ed.getCurrentPageShapes();
        const texts = shapes
            .map(markerTextFromShape)
            .filter((value): value is string => !!value);

        setShapeCount(shapes.length);
        setShapeTexts(texts.join(" | "));
    }, []);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                setLoading(true);
                setError(null);

                if (requestedCanvasId) {
                    try {
                        const existing = await canvasAPI.getCanvas({ canvasId: requestedCanvasId });
                        if (!cancelled) {
                            setCanvasId(existing.id);
                        }
                        return;
                    } catch {
                        // Fall through to create a fresh canvas.
                    }
                }

                const created = await canvasAPI.createCanvas({ title });
                if (cancelled) return;
                setCanvasId(created.id);

                const params = new URLSearchParams(location.search);
                params.set("canvasId", created.id);
                window.history.replaceState({}, "", `${location.pathname}?${params.toString()}`);
            } catch (loadError) {
                if (cancelled) return;
                setError(loadError instanceof Error ? loadError.message : "Failed to create test canvas");
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [canvasAPI, location.pathname, location.search, requestedCanvasId, title]);

    const onMount = useCallback((mountedEditor: Editor) => {
        editorRef.current = mountedEditor;
        setEditor(mountedEditor);
        setEditorReady(true);
        handleMount(mountedEditor);
        refreshShapeSummary();
    }, [handleMount, refreshShapeSummary]);

    useEffect(() => {
        if (!editor) return undefined;
        const removeListener = editor.store.listen(() => {
            refreshShapeSummary();
        }, { source: "all", scope: "document" });
        return () => {
            removeListener();
        };
    }, [editor, refreshShapeSummary]);

    const handleClearCanvas = useCallback(() => {
        setLastAction("clear:clicked");
        const ed = editorRef.current;
        if (!ed) {
            setError("Editor is not ready yet");
            setLastAction("clear:error-editor-not-ready");
            return;
        }
        try {
            const ids = Array.from(ed.getCurrentPageShapeIds());
            if (ids.length === 0) {
                refreshShapeSummary();
                setLastAction("clear:no-shapes");
                return;
            }
            ed.deleteShapes(ids);
            refreshShapeSummary();
            setLastAction(`clear:deleted-${ids.length}`);
        } catch (clearError) {
            setError(clearError instanceof Error ? clearError.message : "Failed to clear canvas");
            setLastAction(`clear:error-${String(clearError)}`);
        }
    }, [refreshShapeSummary]);

    const handleAddMarkerShape = useCallback(() => {
        setLastAction("add:clicked");
        const ed = editorRef.current;
        if (!ed) {
            setError("Editor is not ready yet");
            setLastAction("add:error-editor-not-ready");
            return;
        }

        try {
            const existingCount = ed.getCurrentPageShapes().length;
            const x = 120 + (existingCount % 8) * 28;
            const y = 120 + (existingCount % 6) * 18;

            ed.createShape({
                type: "note",
                x,
                y,
                meta: {
                    marker,
                },
            } as never);

            refreshShapeSummary();
            const after = ed.getCurrentPageShapes().length;
            setLastAction(`add:success-${after}`);
        } catch (addError) {
            setError(addError instanceof Error ? addError.message : "Failed to add marker shape");
            setLastAction(`add:error-${String(addError)}`);
        }
    }, [marker, refreshShapeSummary]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Preparing canvas test page...</div>
            </div>
        );
    }

    if (error || !canvasId) {
        return (
            <div className="h-full p-4">
                <Alert variant="destructive">
                    <AlertDescription>{error ?? "Unable to load canvas test page"}</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div
            className="h-full min-h-0 flex flex-col"
            data-testid="canvas-test-page"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            <header
                className="shrink-0 border-b px-4 py-3 flex items-center justify-between gap-3"
            style={{ borderColor: currentTheme.styles.borderDefault }}
        >
                <div className="min-w-0">
                    <h1 className="text-base font-semibold">Canvas Persistence Test</h1>
                    <p className="text-xs text-muted-foreground truncate">
                        canvas: <span data-testid="canvas-test-canvas-id">{canvasId}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                        marker: <span data-testid="canvas-test-marker">{marker}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleClearCanvas}
                        data-testid="canvas-test-clear"
                    >
                        Clear
                    </Button>
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={handleAddMarkerShape}
                        data-testid="canvas-test-add-shape"
                    >
                        Add marker shape
                    </Button>
                </div>
            </header>

            <div className="px-4 py-2 text-xs border-b flex items-center gap-3" style={{ borderColor: currentTheme.styles.borderDefault }}>
                <span>
                    mode: <strong data-testid="canvas-test-mode">{collabEnabled ? "team-collab" : "local"}</strong>
                </span>
                <span>
                    sync: <strong data-testid="canvas-test-sync">{isSynced ? "synced" : "syncing"}</strong>
                </span>
                <span>
                    editor: <strong data-testid="canvas-test-editor-ready">{editorReady ? "ready" : "loading"}</strong>
                </span>
                <span>
                    shapes: <strong data-testid="canvas-test-shape-count">{shapeCount}</strong>
                </span>
                <span className="truncate">
                    texts: <strong data-testid="canvas-test-shape-texts">{shapeTexts || "(none)"}</strong>
                </span>
                <span className="truncate">
                    action: <strong data-testid="canvas-test-last-action">{lastAction}</strong>
                </span>
            </div>

            <div className="flex-1 min-h-0" data-testid="canvas-test-editor-wrap">
                <Tldraw onMount={onMount} />
            </div>
        </div>
    );
}

export default CanvasTestPage;
