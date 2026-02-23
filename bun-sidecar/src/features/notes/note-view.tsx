import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { todosAPI } from "@/hooks/useTodosAPI";
import { EditorState, Selection, NodeSelection, TextSelection, Plugin } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { exampleSetup } from "prosemirror-example-setup";
import { sinkListItem, liftListItem, wrapInList } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";
import { chainCommands } from "prosemirror-commands";
import { todoKeymap, todoPlugin, toggleTodoAtLine } from "./simple-todo";
import { registerProseMirrorCmdEnter } from "@/hooks/useNativeKeyboardBridge";
import {
    tableSchema,
    tableMarkdownParser,
    tableMarkdownSerializer,
    getTablePlugins,
    fixTables,
    normalizeTableColumns,
} from "@/components/prosemirror/tables";
import {
    createWikiLinkPlugin,
    WikiLinkPopup,
    type WikiLinkPluginState,
} from "@/components/prosemirror/wiki-links";
import "@/components/prosemirror/wiki-links/wiki-links.css";
import {
    createTagLinkPlugin,
    createTagDecorationPlugin,
    closeTagLinkPopup,
    TagLinkPopup,
    type TagLinkPluginState,
} from "@/components/prosemirror/tag-links";
import "@/components/prosemirror/tag-links/tag-links.css";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import "prosemirror-example-setup/style/style.css";
import "prosemirror-view/style/prosemirror.css";
import "@/components/prosemirror/tables/tables.css";
import "./simple-todo.css";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { Note } from "./index";
import { cn } from "@-demos/crdt-lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { useTabScrollPersistence } from "@/hooks/useTabScrollPersistence";
import { useTabCursorPersistence } from "@/hooks/useTabCursorPersistence";
import { useFileLocks } from "@/hooks/useFileLocks";
import { TagInput } from "./TagInput";
import { ProjectInput } from "./ProjectInput";
import { onRefresh, emit, subscribe } from "@-demos/crdt-lib/events";
import { BacklinksPanel, CollapsibleSection } from "./BacklinksPanel";
import { toast } from "sonner";
import { OverlayScrollbar } from "@/components/OverlayScrollbar";
import { SearchPanel } from "@/components/prosemirror/SearchPanel";
import { createSearchPlugin } from "@/components/prosemirror/search-plugin";
import "@/components/prosemirror/search.css";
import { createSpellcheckPlugin, runSpellcheck, clearSpellcheck } from "@/components/prosemirror/spellcheck";
import { SpellcheckPopup } from "@/components/prosemirror/spellcheck/SpellcheckPopup";
import "@/components/prosemirror/spellcheck/spellcheck.css";
import { useCollab } from "@/contexts/CollabContext";
import { crdtDebugLog, summarizeOpsForDebug } from "@-demos/crdt-lib/crdt-debug";
import { buildNoteDocId, getWorkspaceCollabScope } from "@-demos/crdt-lib/collab-doc-id";
import {
    createCRDTPlugin,
    getCRDTState,
    applyRemoteOps,
    applyRemoteSnapshot,
    decodeRecordSnapshot,
    encodeRecordSnapshot,
    getRecordSnapshotStateVector,
    getRecordSnapshotVersion,
    undoCommand,
    redoCommand,
} from "@firstloophq-demos/crdt-lib";
import type { Operation, CRDTPluginState, ClientId } from "@firstloophq-demos/crdt-lib";
import {
    createCollabCursorPlugin,
    updateCollabRemoteCursors,
    awarenessToRemoteCursor,
} from "@/components/prosemirror/collab-cursor-plugin";
import type { RemoteCursor } from "@/components/prosemirror/collab-cursor-plugin";
import "@/styles/collab-cursors.css";

interface NotesViewProps {
    noteFileName: string;
    tabId: string;
    autoFocus?: boolean;
    compact?: boolean; // Hides header toolbar when embedded
    scrollToLine?: number; // Line number to scroll to on initial load
}

interface Heading {
    level: number;
    text: string;
    id: string;
}

const BOOTSTRAP_CLAIM_KEY_PREFIX = "nomendex:crdt-bootstrap";
const BOOTSTRAP_CLAIM_TTL_MS = 4000;
const SHOW_NOTES_RIGHT_SIDEBAR = true; // Temporary debug toggle to isolate duplicate-key crashes.
const NOTE_SNAPSHOT_DEBOUNCE_MS = 1000;

function decodeBase64Bytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function encodeBase64Bytes(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data));
}

function snapshotRecordHasVisibleContent(record: unknown): boolean {
    const body = (record as { body?: { store?: { items?: Array<{
        deleted?: boolean;
        content?: { type?: string; value?: string; blockType?: string };
    }> } } })?.body;
    const items = body?.store?.items ?? [];
    for (const item of items) {
        if (item.deleted) continue;
        const content = item.content;
        if (!content) continue;
        if (content.type === "text" && (content.value ?? "").trim().length > 0) return true;
        if (content.type === "inline_atom") return true;
        if (content.type === "block" && content.blockType && content.blockType !== "paragraph") return true;
    }
    return false;
}

function tryClaimBootstrap(params: { docId: string; clientId: string }): boolean {
    if (typeof window === "undefined") return true;

    const key = `${BOOTSTRAP_CLAIM_KEY_PREFIX}:${params.docId}`;
    const now = Date.now();

    try {
        const existingRaw = window.localStorage.getItem(key);
        if (existingRaw) {
            const existing = JSON.parse(existingRaw) as { clientId?: string; claimedAt?: number };
            if (
                typeof existing.claimedAt === "number" &&
                now - existing.claimedAt < BOOTSTRAP_CLAIM_TTL_MS &&
                existing.clientId &&
                existing.clientId !== params.clientId
            ) {
                return false;
            }
        }

        const claimRaw = JSON.stringify({ clientId: params.clientId, claimedAt: now });
        window.localStorage.setItem(key, claimRaw);

        const confirmedRaw = window.localStorage.getItem(key);
        if (!confirmedRaw) return false;

        const confirmed = JSON.parse(confirmedRaw) as { clientId?: string; claimedAt?: number };
        return (
            confirmed.clientId === params.clientId &&
            typeof confirmed.claimedAt === "number" &&
            now - confirmed.claimedAt < BOOTSTRAP_CLAIM_TTL_MS
        );
    } catch {
        // If storage is unavailable, fall back to optimistic bootstrap.
        return true;
    }
}

function summarizeTransactionForDebug(transaction: { docChanged: boolean; selectionSet: boolean; steps: unknown[] }) {
    const stepDetails = transaction.steps.map((step) => summarizeStepForDebug(step));
    return {
        docChanged: transaction.docChanged,
        selectionSet: transaction.selectionSet,
        stepTypes: stepDetails.map((step) => String(step.kindHint ?? "unknown")),
        stepDetails,
    };
}

function summarizeStepForDebug(step: unknown): Record<string, unknown> {
    if (!step || typeof step !== "object") {
        return { kindHint: typeof step };
    }

    const s = step as {
        constructor?: { name?: string };
        jsonID?: unknown;
        toJSON?: () => unknown;
        from?: unknown;
        to?: unknown;
        gapFrom?: unknown;
        gapTo?: unknown;
        slice?: unknown;
    };

    const summary: Record<string, unknown> = {
        constructor: s.constructor?.name ?? null,
        jsonID: typeof s.jsonID === "string" ? s.jsonID : null,
        hasSlice: s.slice !== undefined,
    };

    if (typeof s.from === "number") summary.from = s.from;
    if (typeof s.to === "number") summary.to = s.to;
    if (typeof s.gapFrom === "number") summary.gapFrom = s.gapFrom;
    if (typeof s.gapTo === "number") summary.gapTo = s.gapTo;

    try {
        if (typeof s.toJSON === "function") {
            const json = s.toJSON();
            if (json && typeof json === "object") {
                const j = json as {
                    stepType?: unknown;
                    from?: unknown;
                    to?: unknown;
                    gapFrom?: unknown;
                    gapTo?: unknown;
                };
                if (typeof j.stepType === "string") summary.toJSONStepType = j.stepType;
                if (summary.from === undefined && typeof j.from === "number") summary.from = j.from;
                if (summary.to === undefined && typeof j.to === "number") summary.to = j.to;
                if (summary.gapFrom === undefined && typeof j.gapFrom === "number") summary.gapFrom = j.gapFrom;
                if (summary.gapTo === undefined && typeof j.gapTo === "number") summary.gapTo = j.gapTo;
            }
        }
    } catch {
        summary.toJSONStepType = "[toJSON-throws]";
    }

    summary.kindHint = summary.toJSONStepType
        ?? summary.jsonID
        ?? summary.constructor
        ?? "UnknownStep";

    return summary;
}

function summarizeDocShapeForDebug(doc: unknown): Record<string, unknown> {
    if (!doc || typeof doc !== "object") return { kind: typeof doc };

    const d = doc as {
        type?: { name?: string };
        childCount?: number;
        child?: (index: number) => unknown;
    };

    const topLevel: Array<Record<string, unknown>> = [];
    const childCount = typeof d.childCount === "number" ? d.childCount : null;
    if (childCount !== null && typeof d.child === "function") {
        const limit = Math.min(childCount, 12);
        for (let i = 0; i < limit; i++) {
            const childNode = d.child(i) as {
                type?: { name?: string };
                childCount?: number;
                child?: (index: number) => unknown;
            };
            const nestedTypes: Array<string> = [];
            if (typeof childNode.childCount === "number" && typeof childNode.child === "function") {
                const nestedLimit = Math.min(childNode.childCount, 6);
                for (let j = 0; j < nestedLimit; j++) {
                    const nested = childNode.child(j) as { type?: { name?: string } };
                    nestedTypes.push(nested.type?.name ?? "unknown");
                }
            }

            topLevel.push({
                index: i,
                type: childNode.type?.name ?? "unknown",
                childCount: typeof childNode.childCount === "number" ? childNode.childCount : null,
                childTypes: nestedTypes,
            });
        }
    }

    return {
        type: d.type?.name ?? "unknown",
        childCount,
        topLevel,
    };
}

function summarizeErrorForDebug(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack ?? null,
        };
    }

    return {
        message: String(error),
    };
}

function createSuggestionInlineActionsPlugin(params: {
    onDecision: (decision: { suggestionId: string; decision: "accept" | "reject" }) => void;
}): Plugin<DecorationSet> {
    const buildDecorations = (doc: EditorState["doc"]): DecorationSet => {
        const suggestionAnchorById = new Map<string, number>();

        doc.descendants((node, pos) => {
            if (!node.isText) return;

            const suggestionMark = node.marks.find(
                (mark) => mark.type.name === "suggestion" && typeof mark.attrs?.id === "string" && mark.attrs.id.trim() !== ""
            );
            if (!suggestionMark) return;

            const suggestionId = String(suggestionMark.attrs?.id || "").trim();
            if (!suggestionId) return;

            const existingPos = suggestionAnchorById.get(suggestionId);
            if (existingPos === undefined || pos < existingPos) {
                suggestionAnchorById.set(suggestionId, pos);
            }
        });

        const decorations = Array.from(suggestionAnchorById.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([suggestionId, pos]) => {
                return Decoration.widget(pos, () => {
                    const anchor = document.createElement("span");
                    anchor.className = "suggestion-inline-actions-anchor";
                    anchor.contentEditable = "false";

                    const actions = document.createElement("span");
                    actions.className = "suggestion-inline-actions";

                    const makeButton = (options: {
                        label: "Y" | "N";
                        title: string;
                        className: string;
                        decision: "accept" | "reject";
                    }) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = `suggestion-inline-action ${options.className}`;
                        button.title = options.title;
                        button.textContent = options.label;
                        button.addEventListener("mousedown", (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        });
                        button.addEventListener("click", (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            params.onDecision({ suggestionId, decision: options.decision });
                        });
                        return button;
                    };

                    actions.append(
                        makeButton({
                            label: "Y",
                            title: "Accept suggestion",
                            className: "suggestion-inline-action-accept",
                            decision: "accept",
                        }),
                        makeButton({
                            label: "N",
                            title: "Reject suggestion",
                            className: "suggestion-inline-action-reject",
                            decision: "reject",
                        }),
                    );

                    anchor.appendChild(actions);
                    return anchor;
                }, { side: -1, key: `suggestion-inline-actions-${suggestionId}` });
            });

        return DecorationSet.create(doc, decorations);
    };

    const plugin = new Plugin<DecorationSet>({
        state: {
            init: (_config, state) => buildDecorations(state.doc),
            apply: (tr, previous) => {
                if (!tr.docChanged) {
                    return previous.map(tr.mapping, tr.doc);
                }
                return buildDecorations(tr.doc);
            },
        },
        props: {
            decorations(state) {
                return plugin.getState(state) ?? DecorationSet.empty;
            },
        },
    });

    return plugin;
}

export function NotesView(props: NotesViewProps) {
    const { noteFileName, tabId, autoFocus = true, compact = false, scrollToLine } = props;
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, openTab } = useWorkspaceContext();
    const { activeWorkspace } = useWorkspaceSwitcher();
    const collab = useCollab();
    const { loading, error, setLoading, setError } = usePlugin();
    const [note, setNote] = useState<Note | null>(null);
    const [content, setContent] = useState("");
    const [_saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
    const [tags, setTags] = useState<string[]>([]);
    const [project, setProject] = useState<string | null>(null);

    const [isRichTextMode] = useState(true);
    const [headings, setHeadings] = useState<Heading[]>([]);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
    const [focusedHeadingIndex, setFocusedHeadingIndex] = useState<number>(0);
    const [isMinimapFocused, setIsMinimapFocused] = useState(false);
    const [wikiLinkState, setWikiLinkState] = useState<WikiLinkPluginState>({
        active: false,
        range: null,
        query: "",
        selectedIndex: 0,
    });
    const [tagLinkState, setTagLinkState] = useState<TagLinkPluginState>({
        active: false,
        range: null,
        query: "",
        selectedIndex: 0,
    });
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const toolbarContainerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useTabScrollPersistence(tabId);
    const { saveCursor, restoreCursor } = useTabCursorPersistence(tabId);
    const menubarObserverRef = useRef<MutationObserver | null>(null);
    const initializedContentRef = useRef<string>("");
    const currentNoteFileNameRef = useRef<string>("");
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSavedContentRef = useRef<string>("");
    const hasSetTabNameRef = useRef<boolean>(false);
    const minimapRef = useRef<HTMLDivElement>(null);
    const lastKnownMtimeRef = useRef<number | null>(null);
    const prevActiveTabIdRef = useRef<string | undefined>(undefined);
    const localSnapshotSeedRef = useRef<{
        bytes: Uint8Array;
        version: string;
        stateVector: Map<string, number>;
    } | null>(null);
    const backendSnapshotVersionRef = useRef<string | null>(null);
    const hydrationRequestIdRef = useRef(0);
    const { currentTheme } = useTheme();
    const { isLocked: isFileLocked } = useFileLocks();
    const isLocked = isFileLocked(noteFileName);

    const hasNote = Boolean(note);
    const hasCollab = Boolean(collab);
    const workspaceId = activeWorkspace?.id?.trim();
    if (!workspaceId) {
        crdtDebugLog({
            event: "note_missing_workspace_scope",
            level: "error",
            data: {
                noteFileName,
                tabId,
                hasActiveWorkspace: Boolean(activeWorkspace),
                activeWorkspaceKeys: activeWorkspace ? Object.keys(activeWorkspace) : [],
            },
        });
        throw new Error(`Missing workspace id while building note collab doc id for "${noteFileName}"`);
    }
    const collabScope = getWorkspaceCollabScope({ activeWorkspace });
    const collabDocId = buildNoteDocId({ scope: collabScope, noteFileName });

    const logHydration = useCallback((params: {
        event: string;
        source?: string;
        reqId?: number;
        data?: Record<string, unknown>;
    }) => {
        crdtDebugLog({
            event: params.event,
            data: {
                noteFileName,
                tabId,
                collabDocId,
                source: params.source ?? null,
                reqId: params.reqId ?? null,
                ...(params.data ?? {}),
            },
        });
    }, [collabDocId, noteFileName, tabId]);

    const applySuggestionDecision = useCallback((params: {
        suggestionId: string;
        decision: "accept" | "reject";
    }) => {
        const view = viewRef.current;
        if (!view) return;

        const suggestionMarkType = view.state.schema.marks.suggestion;
        if (!suggestionMarkType) return;

        const deleteRanges: Array<{ from: number; to: number }> = [];
        const unmarkRanges: Array<{ from: number; to: number; action: "insert" | "delete" }> = [];

        view.state.doc.descendants((node, pos) => {
            if (!node.isText) return;

            const suggestionMark = node.marks.find((mark) => (
                mark.type === suggestionMarkType
                && String(mark.attrs?.id || "") === params.suggestionId
            ));
            if (!suggestionMark) return;

            const action = suggestionMark.attrs?.action === "delete" ? "delete" : "insert";
            const from = pos;
            const to = pos + node.nodeSize;

            if (params.decision === "accept") {
                if (action === "insert") {
                    unmarkRanges.push({ from, to, action });
                } else {
                    deleteRanges.push({ from, to });
                }
            } else if (action === "delete") {
                unmarkRanges.push({ from, to, action });
            } else {
                deleteRanges.push({ from, to });
            }
        });

        if (deleteRanges.length === 0 && unmarkRanges.length === 0) {
            toast("Suggestion not found");
            return;
        }

        let tr = view.state.tr;

        for (const range of unmarkRanges) {
            tr = tr.removeMark(
                range.from,
                range.to,
                suggestionMarkType.create({
                    id: params.suggestionId,
                    action: range.action,
                })
            );
        }

        deleteRanges
            .sort((a, b) => b.from - a.from)
            .forEach((range) => {
                tr = tr.delete(range.from, range.to);
            });

        if (!tr.docChanged && tr.steps.length === 0) {
            return;
        }

        view.dispatch(tr);
    }, []);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        view.setProps({
            editable: () => !isLocked,
        });
    }, [isLocked]);

    useEffect(() => {
        if (!collab) return;

        const onWindowError = (event: ErrorEvent) => {
            crdtDebugLog({
                event: "runtime_error",
                level: "error",
                data: {
                    noteFileName,
                    message: event.message,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    error: summarizeErrorForDebug(event.error),
                    docShape: summarizeDocShapeForDebug(viewRef.current?.state.doc ?? null),
                },
            });
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            crdtDebugLog({
                event: "runtime_unhandled_rejection",
                level: "error",
                data: {
                    noteFileName,
                    reason: summarizeErrorForDebug(event.reason),
                    docShape: summarizeDocShapeForDebug(viewRef.current?.state.doc ?? null),
                },
            });
        };

        window.addEventListener("error", onWindowError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);

        return () => {
            window.removeEventListener("error", onWindowError);
            window.removeEventListener("unhandledrejection", onUnhandledRejection);
        };
    }, [collab, noteFileName]);

    // Subscribe to wiki link click events and navigate
    useEffect(() => {
        return subscribe("wikilink:click", async ({ target }) => {
            // Check if this is a todo link (e.g., todos/todo-1737036787-slug.md)
            if (target.startsWith("todos/")) {
                // Extract the todo ID from the path (remove "todos/" prefix and ".md" suffix)
                let selectedTodoId = target.slice(6); // Remove "todos/" prefix
                if (selectedTodoId.endsWith(".md")) {
                    selectedTodoId = selectedTodoId.slice(0, -3); // Remove ".md" suffix
                }

                // Fetch the todo to get its project
                try {
                    const todo = await todosAPI.getTodoById({ todoId: selectedTodoId });
                    openTab({
                        pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
                        view: "browser",
                        props: { project: todo.project, selectedTodoId },
                    });
                } catch (error) {
                    console.error("Failed to fetch todo for wiki link:", error);
                    // Fallback: open todos without project filter
                    openTab({
                        pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
                        view: "browser",
                        props: { selectedTodoId },
                    });
                }
                return;
            }

            // Default: open as a note
            openTab({
                pluginMeta: { id: "notes", name: "Notes", icon: "file" },
                view: "editor",
                props: { noteFileName: `${target}.md` },
            });
        });
    }, [openTab]);

    // Subscribe to tag click events and navigate to tag detail
    useEffect(() => {
        return subscribe("tag:click", ({ tag }) => {
            openTab({
                pluginMeta: { id: "tags", name: "Tags", icon: "hash" },
                view: "detail",
                props: { tagName: tag },
            });
        });
    }, [openTab]);

    // Subscribe to copy markdown events
    useEffect(() => {
        return subscribe("notes:copyMarkdown", ({ noteFileName: targetFileName }) => {
            // Only handle if this is the note being copied
            if (targetFileName !== noteFileName) return;

            // Get current markdown from editor if available, otherwise use state
            let markdown = content;
            if (viewRef.current) {
                markdown = tableMarkdownSerializer.serialize(viewRef.current.state.doc);
            }

            // Copy to clipboard
            navigator.clipboard.writeText(markdown).catch((err) => {
                console.error("Failed to copy markdown:", err);
            });
        });
    }, [noteFileName, content]);

    // Subscribe to clear content events for test/editor automation flows.
    useEffect(() => {
        return subscribe("notes:clearContent", ({ noteFileName: targetFileName }) => {
            if (targetFileName !== noteFileName) return;
            const view = viewRef.current;
            if (!view) return;

            const top = view.state.doc.firstChild;
            const isAlreadyEmptyParagraph = Boolean(
                view.state.doc.childCount === 1
                && top
                && top.type.name === "paragraph"
                && top.textContent.trim().length === 0
            );
            if (isAlreadyEmptyParagraph) {
                return;
            }

            const emptyParagraph = tableSchema.nodes.paragraph.createAndFill();
            if (!emptyParagraph) return;

            // Drive clear through a concrete PM transaction so CRDT captures and rebroadcasts it.
            const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, emptyParagraph);
            view.dispatch(tr);
            view.focus();
        });
    }, [noteFileName]);

    // Subscribe to run spellcheck events
    useEffect(() => {
        return subscribe("notes:runSpellcheck", () => {
            if (viewRef.current) {
                runSpellcheck(viewRef.current);
            }
        });
    }, []);

    // Subscribe to clear spellcheck events
    useEffect(() => {
        return subscribe("notes:clearSpellcheck", () => {
            if (viewRef.current) {
                clearSpellcheck(viewRef.current);
            }
        });
    }, []);

    // Memoize API instance to prevent infinite rerenders
    const notesAPI = useNotesAPI();

    // Parse headings from markdown content
    const parseHeadings = useCallback((markdown: string): Heading[] => {
        const lines = markdown.split("\n");
        const extractedHeadings: Heading[] = [];

        lines.forEach((line) => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match && match[1] && match[2]) {
                const level = match[1].length;
                // Strip markdown formatting (bold, italic, code, links)
                const text = match[2]
                    .trim()
                    .replace(/\*\*(.+?)\*\*/g, "$1") // bold **text**
                    .replace(/\*(.+?)\*/g, "$1") // italic *text*
                    .replace(/__(.+?)__/g, "$1") // bold __text__
                    .replace(/_(.+?)_/g, "$1") // italic _text_
                    .replace(/`(.+?)`/g, "$1") // code `text`
                    .replace(/\[(.+?)\]\(.+?\)/g, "$1"); // links [text](url)
                const id = text
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, "")
                    .replace(/\s+/g, "-");
                extractedHeadings.push({ level, text, id });
            }
        });

        return extractedHeadings;
    }, []);

    // Scroll to heading in editor (preview only - doesn't move cursor or change focus)
    const scrollToHeadingPreview = useCallback(
        (headingId: string) => {
            if (!viewRef.current || !editorRef.current) return;

            const doc = viewRef.current.state.doc;
            const headingToFind = headings.find((h) => h.id === headingId);
            if (!headingToFind) return;

            // Find the heading position in the document
            let foundPos = -1;
            doc.descendants((node, pos) => {
                if (node.type.name === "heading" && node.textContent.trim() === headingToFind.text) {
                    foundPos = pos;
                    return false;
                }
            });

            if (foundPos !== -1) {
                const domAtPos = viewRef.current.domAtPos(foundPos);
                if (domAtPos && domAtPos.node) {
                    const element = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement;
                    if (element) {
                        element.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                }
            }
        },
        [headings]
    );

    // Scroll to heading and move cursor (used when selecting with Enter)
    const scrollToHeading = useCallback(
        (headingId: string) => {
            if (!viewRef.current || !editorRef.current) return;

            const doc = viewRef.current.state.doc;
            const headingToFind = headings.find((h) => h.id === headingId);
            if (!headingToFind) return;

            // Find the heading position in the document
            let foundPos = -1;
            doc.descendants((node, pos) => {
                if (node.type.name === "heading" && node.textContent.trim() === headingToFind.text) {
                    foundPos = pos;
                    return false;
                }
            });

            if (foundPos !== -1) {
                // Set selection at the heading and move cursor there
                const tr = viewRef.current.state.tr.setSelection(Selection.near(doc.resolve(foundPos)));
                viewRef.current.dispatch(tr);

                // Exit TOC mode and focus editor
                setIsMinimapFocused(false);
                setActiveHeadingId(headingId);

                // Small delay then scroll and focus
                requestAnimationFrame(() => {
                    const domAtPos = viewRef.current!.domAtPos(foundPos);
                    if (domAtPos && domAtPos.node) {
                        const element = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement;
                        if (element) {
                            element.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                    }
                    // Focus the editor after scrolling
                    viewRef.current?.focus();
                });
            }
        },
        [headings]
    );

    // Update active heading based on cursor position
    const updateActiveHeadingFromCursor = useCallback(() => {
        if (!viewRef.current || headings.length === 0) return;

        const state = viewRef.current.state;
        const cursorPos = state.selection.from;
        const doc = state.doc;

        // Find the closest heading before the cursor position
        let closestHeading: string | null = null;
        let closestPos = -1;

        doc.descendants((node, pos) => {
            if (node.type.name === "heading" && pos <= cursorPos) {
                const headingText = node.textContent.trim();
                const matchingHeading = headings.find((h) => h.text === headingText);

                if (matchingHeading && pos > closestPos) {
                    closestPos = pos;
                    closestHeading = matchingHeading.id;
                }
            }
        });

        // If no heading found before cursor, use the first heading
        if (!closestHeading && headings.length > 0) {
            closestHeading = headings[0]?.id || null;
        }

        if (closestHeading && closestHeading !== activeHeadingId) {
            setActiveHeadingId(closestHeading);
            const index = headings.findIndex((h) => h.id === closestHeading);
            if (index !== -1) {
                setFocusedHeadingIndex(index);
            }
        }
    }, [headings, activeHeadingId]);

    // Update active heading based on scroll position (fallback for when cursor isn't moving)
    const updateActiveHeadingFromScroll = useCallback(() => {
        if (!editorRef.current || headings.length === 0) return;

        const editor = editorRef.current.querySelector(".ProseMirror");
        if (!editor) return;

        const editorRect = editor.getBoundingClientRect();
        const viewportMiddle = editorRect.top + editorRect.height / 3;

        // Find all heading elements in the editor
        const headingElements = editor.querySelectorAll("h1, h2, h3, h4, h5, h6");

        let closestHeading: string | null = null;
        let closestDistance = Infinity;

        headingElements.forEach((element) => {
            const rect = element.getBoundingClientRect();
            const distance = Math.abs(rect.top - viewportMiddle);

            const headingText = element.textContent?.trim() || "";
            const matchingHeading = headings.find((h) => h.text === headingText);

            if (matchingHeading && distance < closestDistance && rect.top <= viewportMiddle) {
                closestDistance = distance;
                closestHeading = matchingHeading.id;
            }
        });

        if (closestHeading && closestHeading !== activeHeadingId) {
            setActiveHeadingId(closestHeading);
            const index = headings.findIndex((h) => h.id === closestHeading);
            if (index !== -1) {
                setFocusedHeadingIndex(index);
            }
        }
    }, [headings, activeHeadingId]);

    // Immediate save function (for blur events)
    const saveImmediately = useCallback(
        async (contentToSave: string) => {
            if (contentToSave === lastSavedContentRef.current) {
                setSaveState("saved");
                return;
            }

            try {
                setSaveState("saving");
                const savedNote = await notesAPI.saveNote({ fileName: noteFileName, content: contentToSave });
                lastSavedContentRef.current = contentToSave;
                // Update mtime to prevent false "external change" detection
                if (savedNote?.mtime) {
                    lastKnownMtimeRef.current = savedNote.mtime;
                }
                setSaveState("saved");
            } catch {
                setSaveState("error");
                setTimeout(() => setSaveState("unsaved"), 3000); // Reset error state after 3s
            }
        },
        [notesAPI, noteFileName]
    );

    // Debounced auto-save function
    const debouncedSave = useCallback(
        async (contentToSave: string) => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            saveTimeoutRef.current = setTimeout(async () => {
                if (contentToSave === lastSavedContentRef.current) {
                    setSaveState("saved");
                    return;
                }

                try {
                    setSaveState("saving");
                    const savedNote = await notesAPI.saveNote({ fileName: noteFileName, content: contentToSave });
                    lastSavedContentRef.current = contentToSave;
                    // Update mtime to prevent false "external change" detection
                    if (savedNote?.mtime) {
                        lastKnownMtimeRef.current = savedNote.mtime;
                    }
                    setSaveState("saved");
                } catch {
                    setSaveState("error");
                    setTimeout(() => setSaveState("unsaved"), 3000); // Reset error state after 3s
                }
            }, 200); // 0.2 second delay
        },
        [notesAPI, noteFileName]
    );

    // Handle tag updates
    const handleTagsChange = useCallback(
        async (newTags: string[]) => {
            setTags(newTags);
            try {
                const updatedNote = await notesAPI.updateNoteTags({ fileName: noteFileName, tags: newTags });
                setNote(updatedNote);
                setContent(updatedNote.content);
                lastSavedContentRef.current = updatedNote.content;
            } catch (err) {
                console.error("Failed to update tags:", err);
            }
        },
        [notesAPI, noteFileName]
    );

    // Handle project updates
    const handleProjectChange = useCallback(
        async (newProject: string | null) => {
            setProject(newProject);
            try {
                const updatedNote = await notesAPI.updateNoteProject({ fileName: noteFileName, project: newProject });
                setNote(updatedNote);
                setContent(updatedNote.content);
                lastSavedContentRef.current = updatedNote.content;
            } catch (err) {
                console.error("Failed to update project:", err);
            }
        },
        [notesAPI, noteFileName]
    );

    // Update content and trigger save state change
    const updateContent = useCallback(
        (newContent: string) => {
            setContent(newContent);
            setHeadings(parseHeadings(newContent));
            if (newContent !== lastSavedContentRef.current) {
                setSaveState("unsaved");
                debouncedSave(newContent);
            }
        },
        [debouncedSave, parseHeadings]
    );

    // Update tab name to show just the document name - only once when component mounts
    useEffect(() => {
        // Only set tab name when this tab is active and we haven't set it yet
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            // Remove .md extension for cleaner display
            const displayName = noteFileName.replace(/\.md$/, "");
            setTabName(tabId, displayName);
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, noteFileName, setTabName]);

    useEffect(() => {
        let cancelled = false;
        const effectStartReqId = hydrationRequestIdRef.current;

        const fetchData = async () => {
            const reqId = ++hydrationRequestIdRef.current;
            try {
                logHydration({
                    event: "note_fetch_start",
                    reqId,
                    source: "fetch",
                });
                setLoading(true);
                setError(null);
                if (!notesAPI || !notesAPI.getNotes) {
                    throw new Error("Notes API not found");
                }
                const noteResult = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });

                // Don't update state if component unmounted or note changed
                if (cancelled) {
                    logHydration({
                        event: "note_fetch_cancelled_before_apply",
                        reqId,
                        source: "fetch",
                    });
                    return;
                }
                if (reqId !== hydrationRequestIdRef.current) {
                    logHydration({
                        event: "note_fetch_stale_skip",
                        reqId,
                        source: "fetch",
                        data: {
                            latestReqId: hydrationRequestIdRef.current,
                            reason: "superseded_after_note_load",
                        },
                    });
                    return;
                }

                const noteContent = noteResult?.content || "";
                logHydration({
                    event: "note_fetch_done",
                    reqId,
                    source: "fetch",
                    data: {
                        contentLen: noteContent.length,
                        mtime: noteResult?.mtime ?? null,
                    },
                });
                if (collab) {
                    try {
                        const snapshotRes = await fetch("/api/crdt/note-snapshot/get", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ docId: collabDocId }),
                        });

                        if (snapshotRes.ok) {
                            const payload = await snapshotRes.json() as {
                                snapshot: string | null;
                                meta: {
                                    snapshotVersion?: string;
                                    lastKnownBackendVersion?: string;
                                } | null;
                            };
                            if (payload.snapshot) {
                                const bytes = decodeBase64Bytes(payload.snapshot);
                                const version = payload.meta?.snapshotVersion
                                    ?? getRecordSnapshotVersion({ data: bytes });
                                const stateVector = new Map(getRecordSnapshotStateVector({ data: bytes }));
                                localSnapshotSeedRef.current = { bytes, version, stateVector };
                                backendSnapshotVersionRef.current = payload.meta?.lastKnownBackendVersion
                                    ?? payload.meta?.snapshotVersion
                                    ?? null;
                                crdtDebugLog({
                                    event: "note_snapshot_seed_loaded",
                                    data: {
                                        docId: collabDocId,
                                        hasSnapshot: true,
                                        bytes: bytes.byteLength,
                                        version,
                                    },
                                });
                                logHydration({
                                    event: "note_snapshot_seed_loaded",
                                    reqId,
                                    source: "fetch",
                                    data: {
                                        hasSnapshot: true,
                                        bytes: bytes.byteLength,
                                        version,
                                    },
                                });
                            } else {
                                logHydration({
                                    event: "note_snapshot_seed_loaded",
                                    reqId,
                                    source: "fetch",
                                    data: {
                                        hasSnapshot: false,
                                    },
                                });
                                localSnapshotSeedRef.current = null;
                            }
                        }
                    } catch (snapshotError) {
                        localSnapshotSeedRef.current = null;
                        logHydration({
                            event: "note_snapshot_seed_error",
                            reqId,
                            source: "fetch",
                            data: {
                                error: summarizeErrorForDebug(snapshotError),
                            },
                        });
                    }
                } else {
                    localSnapshotSeedRef.current = null;
                    backendSnapshotVersionRef.current = null;
                }
                if (cancelled) {
                    logHydration({
                        event: "note_fetch_cancelled_before_state_apply",
                        reqId,
                        source: "fetch",
                    });
                    return;
                }
                if (reqId !== hydrationRequestIdRef.current) {
                    logHydration({
                        event: "note_fetch_stale_skip",
                        reqId,
                        source: "fetch",
                        data: {
                            latestReqId: hydrationRequestIdRef.current,
                            reason: "superseded_before_state_apply",
                        },
                    });
                    return;
                }
                setNote(noteResult);
                setContent(noteContent);
                setHeadings(parseHeadings(noteContent));
                lastSavedContentRef.current = noteContent;
                lastKnownMtimeRef.current = noteResult?.mtime ?? null;
                setSaveState("saved");
                logHydration({
                    event: "note_fetch_state_applied",
                    reqId,
                    source: "fetch",
                    data: {
                        contentLen: noteContent.length,
                    },
                });

                // Extract tags from front matter
                const noteTags = noteResult?.frontMatter?.tags;
                if (Array.isArray(noteTags)) {
                    setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                } else {
                    setTags([]);
                }

                // Extract project from front matter
                const noteProject = noteResult?.frontMatter?.project;
                if (typeof noteProject === "string") {
                    setProject(noteProject);
                } else {
                    setProject(null);
                }
            } catch (err) {
                if (cancelled) return;
                logHydration({
                    event: "note_fetch_error",
                    reqId,
                    source: "fetch",
                    data: {
                        error: summarizeErrorForDebug(err),
                    },
                });
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch notes";
                setError(errorMessage);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    logHydration({
                        event: "note_fetch_finalized",
                        reqId,
                        source: "fetch",
                        data: {
                            isLatestReq: reqId === hydrationRequestIdRef.current,
                        },
                    });
                }
            }
        };
        fetchData();

        return () => {
            logHydration({
                event: "note_fetch_effect_cleanup",
                source: "fetch",
                data: {
                    effectStartReqId,
                },
            });
            cancelled = true;
        };
    }, [noteFileName, notesAPI, setLoading, setError, parseHeadings, collab, collabDocId, logHydration]);

    // Listen for refresh events to reload tags and project
    useEffect(() => {
        const unsubscribe = onRefresh(
            async (detail) => {
                // Only refresh if this is the note being refreshed
                if (detail.identifier === noteFileName) {
                    try {
                        const noteResult = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });
                        const noteTags = noteResult?.frontMatter?.tags;
                        if (Array.isArray(noteTags)) {
                            setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                        } else {
                            setTags([]);
                        }
                        // Extract project from front matter
                        const noteProject = noteResult?.frontMatter?.project;
                        if (typeof noteProject === "string") {
                            setProject(noteProject);
                        } else {
                            setProject(null);
                        }
                        // Update note state to reflect new front matter
                        setNote(noteResult);
                    } catch (error) {
                        console.error("Failed to refresh note:", error);
                    }
                }
            },
            "note"
        );

        return unsubscribe;
    }, [noteFileName, notesAPI]);

    // Store updateActiveHeadingFromCursor in a ref to avoid infinite rerenders
    const updateActiveHeadingFromCursorRef = useRef(updateActiveHeadingFromCursor);
    useEffect(() => {
        updateActiveHeadingFromCursorRef.current = updateActiveHeadingFromCursor;
    }, [updateActiveHeadingFromCursor]);

    // Initialize ProseMirror editor - wait for content to be loaded
    useEffect(() => {
        if (!editorRef.current || !isRichTextMode || !note) {
            logHydration({
                event: "note_editor_guard_blocked",
                source: "editor_effect",
                data: {
                    hasEditorRef: Boolean(editorRef.current),
                    isRichTextMode,
                    hasNote: Boolean(note),
                },
            });
            return;
        }

        // Wait until we have the correct note data loaded
        if (note.fileName !== noteFileName) {
            logHydration({
                event: "note_editor_guard_note_mismatch",
                source: "editor_effect",
                data: {
                    loadedFileName: note.fileName,
                    expectedFileName: noteFileName,
                },
            });
            return;
        }

        // Check if this is a different note than what's in the editor
        const isNewNote = currentNoteFileNameRef.current !== noteFileName;
        const contentToUse = note.content || "";
        logHydration({
            event: "note_editor_branch",
            source: "editor_effect",
            data: {
                hasView: !!viewRef.current,
                currentNoteInView: currentNoteFileNameRef.current || null,
                isNewNote,
                contentToUseLen: contentToUse.length,
                initializedLen: initializedContentRef.current.length,
            },
        });

        // If editor exists and note changed, reuse the editor by swapping content
        if (isNewNote && viewRef.current) {
            const doc = tableMarkdownParser.parse(contentToUse) || tableSchema.nodes.doc.createAndFill();
            // Create new state with same plugins but new document
            const stateWithNewDoc = EditorState.create({
                doc,
                plugins: viewRef.current.state.plugins,
                selection: Selection.atStart(doc!),
            });
            viewRef.current.updateState(stateWithNewDoc);
            logHydration({
                event: "note_editor_reuse_update",
                source: "editor_reuse",
                data: {
                    parsedDocTextLen: doc?.textContent?.length ?? 0,
                    parsedMarkdownLen: tableMarkdownSerializer.serialize(doc!).length,
                },
            });
            currentNoteFileNameRef.current = noteFileName;
            initializedContentRef.current = contentToUse;

            // Re-register Cmd+Enter handler (cleanup from previous render unregistered it)
            const view = viewRef.current;
            const unregisterCmdEnter = registerProseMirrorCmdEnter(view.dom as HTMLElement, () => {
                return toggleTodoAtLine(view.state, view.dispatch);
            });

            return () => {
                logHydration({
                    event: "note_editor_reuse_cleanup",
                    source: "editor_reuse",
                    data: {
                        mode: "update",
                        noteFileName,
                    },
                });
                unregisterCmdEnter();
            };
        }

        // If no note change and editor exists, nothing to do
        if (!isNewNote && viewRef.current) {
            logHydration({
                event: "note_editor_reuse_noop",
                source: "editor_reuse",
                data: {
                    currentDocTextLen: viewRef.current.state.doc.textContent.length,
                    currentMarkdownLen: tableMarkdownSerializer.serialize(viewRef.current.state.doc).length,
                },
            });
            // Re-register Cmd+Enter handler (cleanup from previous render unregistered it)
            const view = viewRef.current;
            const unregisterCmdEnter = registerProseMirrorCmdEnter(view.dom as HTMLElement, () => {
                return toggleTodoAtLine(view.state, view.dispatch);
            });

            return () => {
                logHydration({
                    event: "note_editor_reuse_cleanup",
                    source: "editor_reuse",
                    data: {
                        mode: "noop",
                        noteFileName,
                    },
                });
                unregisterCmdEnter();
            };
        }

        // Only destroy if we're creating fresh (shouldn't happen often now)
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        // In team mode with collab, use CRDT for document state
        const isCollabMode = !!collab;
        crdtDebugLog({
            event: "note_editor_init",
            data: {
                noteFileName,
                tabId,
                docId: collabDocId,
                isCollabMode,
                collabClientId: collab?.clientId ?? null,
            },
        });

        // In both solo and collab modes, parse the doc from markdown
        const doc = tableMarkdownParser.parse(contentToUse) || tableSchema.nodes.doc.createAndFill();

        // Custom keymap for tab indentation in lists
        const listIndentKeymap = keymap({
            "Tab": chainCommands(sinkListItem(tableSchema.nodes.list_item), wrapInList(tableSchema.nodes.bullet_list)),
            "Shift-Tab": liftListItem(tableSchema.nodes.list_item),
        });

        // Wiki link plugin for [[note]] suggestions
        const wikiLinkPlugin = createWikiLinkPlugin({
            schema: tableSchema,
            onStateChange: setWikiLinkState,
        });

        // Tag link plugin for #tag suggestions
        const tagLinkPlugin = createTagLinkPlugin({
            onStateChange: setTagLinkState,
        });

        // Tag decoration plugin for styling completed tags and atomic deletion
        const tagDecorationPlugin = createTagDecorationPlugin();

        // Search plugin for CMD+F functionality
        const searchPlugin = createSearchPlugin();

        // Spellcheck plugin for spell checking
        const spellcheckPlugin = createSpellcheckPlugin();
        const suggestionInlineActionsPlugin = createSuggestionInlineActionsPlugin({
            onDecision: applySuggestionDecision,
        });

        // Build CRDT plugin + cursor plugin + undo/redo keymap for collab mode
        let crdtPlugin: Plugin<CRDTPluginState> | null = null;
        let cursorPlugin: Plugin | null = null;
        // Gate bootstrap ops: suppress onLocalOps until initial sync completes,
        // so only the first client bootstraps the doc on the server.
        let syncComplete = false;
        let pendingLocalOps: Operation[] = [];

        if (isCollabMode && collab) {
            crdtPlugin = createCRDTPlugin({
                clientId: collab.clientId,
                schema: tableSchema,
                onLocalOps: (ops: ReadonlyArray<Operation>) => {
                    if (ops.length === 0) return;
                    crdtDebugLog({
                        event: "local_ops_captured",
                        data: {
                            docId: collabDocId,
                            syncComplete,
                            count: ops.length,
                            ops: summarizeOpsForDebug(ops),
                        },
                    });

                    // During initial sync, queue local ops so they can be flushed
                    // after sync completes instead of being dropped.
                    if (!syncComplete) {
                        pendingLocalOps.push(...ops);
                        crdtDebugLog({
                            event: "local_ops_queued_presync",
                            data: {
                                docId: collabDocId,
                                queuedCount: pendingLocalOps.length,
                            },
                        });
                        return;
                    }

                    collab.sendOps({
                        docId: collabDocId,
                        ops: ops as ReadonlyArray<Operation>,
                    });
                    crdtDebugLog({
                        event: "local_ops_sent",
                        data: {
                            docId: collabDocId,
                            count: ops.length,
                            ops: summarizeOpsForDebug(ops),
                        },
                    });
                },
            });
            cursorPlugin = createCollabCursorPlugin({ localClientId: collab.clientId });
        }

        // CRDT undo/redo keymap (replaces default history in collab mode)
        const crdtUndoRedoKeymap = crdtPlugin ? keymap({
            "Mod-z": (_state, _dispatch, view) => {
                if (!view || !crdtPlugin) return false;
                const result = undoCommand({ state: view.state, plugin: crdtPlugin });
                if (!result) return false;
                view.updateState(result.state);
                return true;
            },
            "Mod-Shift-z": (_state, _dispatch, view) => {
                if (!view || !crdtPlugin) return false;
                const result = redoCommand({ state: view.state, plugin: crdtPlugin });
                if (!result) return false;
                view.updateState(result.state);
                return true;
            },
        }) : null;

        // Build plugin list: in collab mode, add CRDT plugins and disable built-in history
        const collabPlugins = crdtPlugin
            ? [
                crdtPlugin,
                ...(cursorPlugin ? [cursorPlugin] : []),
                ...(crdtUndoRedoKeymap ? [crdtUndoRedoKeymap] : []),
            ]
            : [];

        const plugins = isCollabMode
            ? [
                ...getTablePlugins(),
                todoKeymap,
                ...collabPlugins,
                ...exampleSetup({ schema: tableSchema, floatingMenu: false, history: false }),
                listIndentKeymap,
                todoPlugin,
                wikiLinkPlugin,
                tagLinkPlugin,
                tagDecorationPlugin,
                suggestionInlineActionsPlugin,
                searchPlugin,
                spellcheckPlugin,
            ]
            : [
                ...getTablePlugins(),
                todoKeymap,
                ...exampleSetup({ schema: tableSchema, floatingMenu: false }),
                listIndentKeymap,
                todoPlugin,
                wikiLinkPlugin,
                tagLinkPlugin,
                tagDecorationPlugin,
                suggestionInlineActionsPlugin,
                searchPlugin,
                spellcheckPlugin,
            ];

        let state = EditorState.create({
            doc: doc!,
            plugins,
        });

        // Apply table fixes to ensure proper table structure
        const fixTransaction = fixTables(state);
        if (fixTransaction) {
            state = state.apply(fixTransaction);
        }

        // Normalize table column counts (ensures all rows have same number of cells)
        const normalizeTransaction = normalizeTableColumns(state);
        if (normalizeTransaction) {
            state = state.apply(normalizeTransaction);
        }

        // Use `let` so dispatchTransaction can reference viewInstance before
        // the EditorView constructor returns. ySyncPlugin dispatches during
        // construction, which would hit the TDZ with `const view = new ...`.
        let viewInstance: EditorView | null = null;

        const updateEditorStateSafely = (view: EditorView, nextState: EditorState, source: string): boolean => {
            const shouldRestoreFocus = view.hasFocus();
            try {
                view.updateState(nextState);
                return true;
            } catch (updateError) {
                crdtDebugLog({
                    event: "editor_updatestate_failed",
                    level: "error",
                    data: {
                        source,
                        docId: collabDocId,
                        error: summarizeErrorForDebug(updateError),
                    },
                });

                try {
                    const recoveredState = EditorState.create({
                        doc: nextState.doc,
                        plugins: view.state.plugins,
                        selection: nextState.selection,
                    });
                    view.updateState(recoveredState);
                    if (shouldRestoreFocus && !view.hasFocus()) {
                        view.focus();
                    }

                    crdtDebugLog({
                        event: "editor_updatestate_recovered",
                        data: {
                            source,
                            docId: collabDocId,
                        },
                    });
                    return true;
                } catch (recoveryError) {
                    crdtDebugLog({
                        event: "editor_updatestate_recovery_failed",
                        level: "error",
                        data: {
                            source,
                            docId: collabDocId,
                            error: summarizeErrorForDebug(recoveryError),
                        },
                    });
                    return false;
                }
            }
        };

        let snapshotPersistTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleSnapshotPersist = (source: "local" | "remote-merged") => {
            if (!isCollabMode || !collab || !crdtPlugin || !editorView || editorView.isDestroyed) return;
            if (snapshotPersistTimer) {
                clearTimeout(snapshotPersistTimer);
            }

            snapshotPersistTimer = setTimeout(async () => {
                if (!editorView || editorView.isDestroyed) return;
                try {
                    const pluginState = getCRDTState({
                        state: editorView.state,
                        plugin: crdtPlugin!,
                    });
                    const pluginDoc = pluginState.doc as {
                        appliedOps: ReadonlySet<string>;
                        stateVector: ReadonlyMap<string, number>;
                    };
                    const record = {
                        fields: new Map<string, unknown>(),
                        sets: new Map<string, unknown>(),
                        body: pluginDoc as unknown,
                        appliedOps: new Set(pluginDoc.appliedOps),
                        stateVector: new Map(pluginDoc.stateVector),
                    };
                    const snapshot = encodeRecordSnapshot({ record: record as any });
                    const snapshotVersion = getRecordSnapshotVersion({ data: snapshot });
                    const stateVector = Object.fromEntries(record.stateVector);

                    await fetch("/api/crdt/note-snapshot/save", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            docId: collabDocId,
                            snapshot: encodeBase64Bytes(snapshot),
                            meta: {
                                docId: collabDocId,
                                snapshotVersion,
                                updatedAt: new Date().toISOString(),
                                stateVector,
                                source,
                                lastKnownBackendVersion: backendSnapshotVersionRef.current ?? undefined,
                            },
                        }),
                    });

                    if (source === "local") {
                        collab.sendSnapshot({
                            docId: collabDocId,
                            snapshot,
                            expectedVersion: backendSnapshotVersionRef.current ?? undefined,
                            mergeBias: "remote",
                        });
                    }
                    localSnapshotSeedRef.current = {
                        bytes: snapshot,
                        version: snapshotVersion,
                        stateVector: new Map(pluginDoc.stateVector),
                    };
                    crdtDebugLog({
                        event: "note_snapshot_saved",
                        data: {
                            docId: collabDocId,
                            source,
                            bytes: snapshot.byteLength,
                            version: snapshotVersion,
                        },
                    });
                } catch (error) {
                    crdtDebugLog({
                        event: "note_snapshot_save_failed",
                        level: "error",
                        data: {
                            docId: collabDocId,
                            source,
                            error: summarizeErrorForDebug(error),
                        },
                    });
                }
            }, NOTE_SNAPSHOT_DEBOUNCE_MS);
        };

        const editorView = new EditorView(editorRef.current, {
            state,
            editable: () => !isLocked,
            dispatchTransaction(transaction) {
                const v = viewInstance;
                if (!v) return;
                const newState = v.state.apply(transaction);
                const updated = updateEditorStateSafely(v, newState, "local_dispatch");
                if (!updated) {
                    return;
                }
                if (transaction.docChanged || transaction.selectionSet) {
                    crdtDebugLog({
                        event: "pm_dispatch",
                        data: {
                            docId: collabDocId,
                            selection: {
                                from: newState.selection.from,
                                to: newState.selection.to,
                            },
                            transaction: summarizeTransactionForDebug(transaction),
                        },
                    });
                }

                // Check if selection changed
                if (transaction.selectionSet) {
                    // Update active heading based on cursor position
                    setTimeout(() => updateActiveHeadingFromCursorRef.current(), 0);
                    // Save cursor position for persistence
                    saveCursor(v);

                    // Send cursor awareness in collab mode
                    if (collab) {
                        const { from, to } = newState.selection;
                        collab.sendAwareness({
                            docId: collabDocId,
                            state: {
                                cursor: { anchor: from, head: to },
                                viewingDocId: collabDocId,
                                user: collab.userInfo,
                                lastUpdated: Date.now(),
                            },
                        });
                    }
                }

                const markdown = tableMarkdownSerializer.serialize(newState.doc);
                updateContent(markdown);
                if (transaction.docChanged) {
                    logHydration({
                        event: "note_render_state",
                        source: "local_dispatch",
                        data: {
                            docTextLen: newState.doc.textContent.length,
                            markdownLen: markdown.length,
                        },
                    });
                }
                if (transaction.docChanged && collab && crdtPlugin) {
                    scheduleSnapshotPersist("local");
                }
            },
            handleDOMEvents: {
                mousedown: (_view, event) => {
                    // Prevent selection change when clicking on tag links
                    const target = event.target as HTMLElement;
                    const tagLinkElement = target.classList.contains("tag-link")
                        ? target
                        : target.closest(".tag-link");
                    if (tagLinkElement) {
                        event.preventDefault();
                        return true;
                    }
                    return false;
                },
                keydown: (view, event) => {
                    crdtDebugLog({
                        event: "editor_keydown",
                        data: {
                            docId: collabDocId,
                            key: event.key,
                            code: event.code,
                            metaKey: event.metaKey,
                            ctrlKey: event.ctrlKey,
                            shiftKey: event.shiftKey,
                            altKey: event.altKey,
                            selection: {
                                from: view.state.selection.from,
                                to: view.state.selection.to,
                            },
                        },
                    });
                    return false;
                },
                blur: () => {
                    if (!viewInstance) return false;
                    const markdown = tableMarkdownSerializer.serialize(viewInstance.state.doc);
                    saveImmediately(markdown);
                    return false; // Let other handlers run
                },
                click: (view, event) => {
                    // Handle clicks on tag decorations
                    const target = event.target as HTMLElement;
                    // Check if click is on a tag-link or inside one
                    const tagLinkElement = target.classList.contains("tag-link")
                        ? target
                        : target.closest(".tag-link");

                    if (tagLinkElement) {
                        event.preventDefault();

                        // Get the document position from click coordinates
                        const coords = { left: event.clientX, top: event.clientY };
                        const posAtCoords = view.posAtCoords(coords);

                        if (posAtCoords) {
                            // Find the tag at this position by looking at the text content
                            const pos = posAtCoords.pos;
                            const $pos = view.state.doc.resolve(pos);
                            const textContent = $pos.parent.textContent;
                            const offsetInBlock = $pos.parentOffset;

                            // Find the tag that contains this position
                            // Look backwards for # and forwards for end of tag
                            const TAG_CHAR_REGEX = /[a-zA-Z0-9_-]/;
                            let hashPos = offsetInBlock;

                            // Search backwards for the #
                            while (hashPos > 0 && textContent[hashPos - 1] !== '#') {
                                if (!TAG_CHAR_REGEX.test(textContent[hashPos - 1] || '')) {
                                    break;
                                }
                                hashPos--;
                            }

                            // Check if we found a # right before
                            if (hashPos > 0 && textContent[hashPos - 1] === '#') {
                                // Find the end of the tag
                                let endPos = hashPos;
                                while (endPos < textContent.length && TAG_CHAR_REGEX.test(textContent[endPos] || '')) {
                                    endPos++;
                                }

                                const tagName = textContent.slice(hashPos, endPos);
                                if (tagName) {
                                    // Close any open tag popup before navigating
                                    closeTagLinkPopup(view);
                                    emit("tag:click", { tag: tagName, sourceNote: noteFileName });
                                }
                            }
                        }
                        return true;
                    }
                    return false;
                },
            },
            // Handle clicks on wiki_link nodes
            handleClickOn(_view, _pos, node, _nodePos, event, direct) {
                if (node.type.name === "wiki_link" && direct) {
                    event.preventDefault();
                    const linkTarget = node.attrs.href;
                    // Emit event for navigation - handled by subscriber
                    emit("wikilink:click", { target: linkTarget, sourceNote: noteFileName });
                    return true;
                }
                return false;
            },
            // Handle Enter key on wiki_link nodes
            handleKeyDown(view, event) {
                if (event.key === "Enter") {
                    const { selection } = view.state;

                    // Check if a wiki_link node is selected (NodeSelection)
                    if (selection instanceof NodeSelection) {
                        const selectedNode = selection.node;
                        if (selectedNode.type.name === "wiki_link") {
                            event.preventDefault();
                            emit("wikilink:click", { target: selectedNode.attrs.href, sourceNote: noteFileName });
                            return true;
                        }
                    }

                    // Also handle cursor adjacent to wiki_link
                    const { from, to } = selection;
                    if (from === to) {
                        const $pos = view.state.doc.resolve(from);

                        // Check node immediately before cursor
                        if ($pos.nodeBefore?.type.name === "wiki_link") {
                            event.preventDefault();
                            emit("wikilink:click", { target: $pos.nodeBefore.attrs.href, sourceNote: noteFileName });
                            return true;
                        }

                        // Check node immediately after cursor
                        if ($pos.nodeAfter?.type.name === "wiki_link") {
                            event.preventDefault();
                            emit("wikilink:click", { target: $pos.nodeAfter.attrs.href, sourceNote: noteFileName });
                            return true;
                        }
                    }
                }
                return false;
            },
        });

        viewInstance = editorView;
        viewRef.current = editorView;
        initializedContentRef.current = contentToUse;
        currentNoteFileNameRef.current = noteFileName;

        if (isCollabMode && crdtPlugin && localSnapshotSeedRef.current) {
            try {
                const seed = localSnapshotSeedRef.current;
                const record = decodeRecordSnapshot({ data: seed.bytes });
                if (!snapshotRecordHasVisibleContent(record) && contentToUse.trim().length > 0) {
                    crdtDebugLog({
                        event: "local_snapshot_seed_skipped",
                        data: {
                            docId: collabDocId,
                            reason: "seed_empty_markdown_nonempty",
                            bytes: seed.bytes.byteLength,
                            version: seed.version,
                        },
                    });
                    logHydration({
                        event: "note_local_snapshot_seed_skipped",
                        source: "local_snapshot",
                        data: {
                            bytes: seed.bytes.byteLength,
                            version: seed.version,
                            markdownLen: contentToUse.length,
                        },
                    });
                } else {
                    const seeded = applyRemoteSnapshot({
                        state: editorView.state,
                        plugin: crdtPlugin,
                        snapshotDoc: record.body,
                    });
                    const updated = updateEditorStateSafely(editorView, seeded.state, "local_snapshot_seed");
                    if (updated) {
                        const markdown = tableMarkdownSerializer.serialize(seeded.state.doc);
                        updateContent(markdown);
                        crdtDebugLog({
                            event: "local_snapshot_seed_applied",
                            data: {
                                docId: collabDocId,
                                bytes: seed.bytes.byteLength,
                                version: seed.version,
                            },
                        });
                        logHydration({
                            event: "note_render_state",
                            source: "local_snapshot",
                            data: {
                                docTextLen: seeded.state.doc.textContent.length,
                                markdownLen: markdown.length,
                            },
                        });
                    }
                }
            } catch (error) {
                crdtDebugLog({
                    event: "local_snapshot_seed_failed",
                    level: "error",
                    data: {
                        docId: collabDocId,
                        error: summarizeErrorForDebug(error),
                    },
                });
            }
        }

        // Register Cmd+Enter handler for todo toggle in native Mac app
        const unregisterCmdEnter = registerProseMirrorCmdEnter(editorView.dom as HTMLElement, () => {
            return toggleTodoAtLine(editorView.state, editorView.dispatch);
        });

        // Subscribe to remote CRDT ops and awareness updates in collab mode
        let unsubscribeDoc: (() => void) | null = null;
        let unsubscribeAwareness: (() => void) | null = null;

        if (isCollabMode && collab && crdtPlugin) {
            const docId = collabDocId;
            const capturedCrdtPlugin = crdtPlugin;
            const remoteCursors = new Map<ClientId, RemoteCursor>();
            let receivedRemoteOps = false;
            let bootstrapQueued = false;
            let bootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null;

            const clearBootstrapRetry = () => {
                if (bootstrapRetryTimer) {
                    clearTimeout(bootstrapRetryTimer);
                    bootstrapRetryTimer = null;
                }
            };

            const maybeBootstrap = () => {
                if (bootstrapQueued) {
                    crdtDebugLog({ event: "bootstrap_skip", data: { docId, reason: "already_queued" } });
                    return;
                }
                if (receivedRemoteOps) {
                    crdtDebugLog({ event: "bootstrap_skip", data: { docId, reason: "received_remote_ops" } });
                    return;
                }
                if (pendingLocalOps.length > 0) {
                    crdtDebugLog({
                        event: "bootstrap_skip",
                        data: { docId, reason: "pending_local_ops", pendingCount: pendingLocalOps.length },
                    });
                    return;
                }
                if (!editorView || editorView.isDestroyed) {
                    crdtDebugLog({ event: "bootstrap_skip", data: { docId, reason: "editor_unavailable" } });
                    return;
                }
                if (!tryClaimBootstrap({ docId, clientId: collab.clientId })) {
                    crdtDebugLog({ event: "bootstrap_skip", data: { docId, reason: "claim_denied" } });
                    return;
                }

                bootstrapQueued = true;
                const currentDoc = editorView.state.doc;
                const tr = editorView.state.tr.replaceWith(0, currentDoc.content.size, currentDoc.content);
                editorView.dispatch(tr);
                crdtDebugLog({
                    event: "bootstrap_dispatched",
                    data: { docId, size: currentDoc.content.size },
                });
            };

            // Subscribe to remote doc ops
            logHydration({
                event: "note_collab_subscribe",
                source: "collab",
                data: {
                    docId,
                    hasInitialStateVector: !!localSnapshotSeedRef.current?.stateVector,
                },
            });
            unsubscribeDoc = collab.subscribeDoc({
                docId,
                initialStateVector: localSnapshotSeedRef.current?.stateVector,
                onOps: ({ ops }) => {
                    if (!editorView || editorView.isDestroyed) return;
                    // Filter to only CRDT tree operations (not field/set ops)
                    const treeOps = ops.filter(
                        (op): op is Operation => op.type !== "field" && op.type !== "set"
                    );
                    if (treeOps.length === 0) return;
                    receivedRemoteOps = true;
                    clearBootstrapRetry();
                    crdtDebugLog({
                        event: "remote_ops_received",
                        data: {
                            docId,
                            rawCount: ops.length,
                            treeCount: treeOps.length,
                            ops: summarizeOpsForDebug(treeOps),
                        },
                    });
                    logHydration({
                        event: "note_remote_ops_received",
                        source: "remote_ops",
                        data: {
                            docId,
                            rawCount: ops.length,
                            treeCount: treeOps.length,
                        },
                    });
                    try {
                        const result = applyRemoteOps({
                            state: editorView.state,
                            plugin: capturedCrdtPlugin,
                            ops: treeOps,
                        });

                        try {
                            result.state.doc.check();
                        } catch (validationError) {
                            crdtDebugLog({
                                event: "remote_ops_invalid_doc",
                                level: "error",
                                data: {
                                    docId,
                                    error: summarizeErrorForDebug(validationError),
                                    ops: summarizeOpsForDebug(treeOps),
                                    docShape: summarizeDocShapeForDebug(result.state.doc),
                                },
                            });
                            return;
                        }

                        const updated = updateEditorStateSafely(editorView, result.state, "remote_sync");
                        if (!updated) {
                            return;
                        }
                        crdtDebugLog({
                            event: "remote_ops_applied",
                            data: {
                                docId,
                                selection: {
                                    from: result.state.selection.from,
                                    to: result.state.selection.to,
                                },
                                docShape: summarizeDocShapeForDebug(result.state.doc),
                            },
                        });
                        logHydration({
                            event: "note_render_state",
                            source: "remote_ops",
                            data: {
                                docTextLen: result.state.doc.textContent.length,
                                markdownLen: tableMarkdownSerializer.serialize(result.state.doc).length,
                            },
                        });
                    } catch (applyError) {
                        crdtDebugLog({
                            event: "remote_ops_apply_failed",
                            level: "error",
                            data: {
                                docId,
                                error: summarizeErrorForDebug(applyError),
                                ops: summarizeOpsForDebug(treeOps),
                                beforeDocShape: summarizeDocShapeForDebug(editorView.state.doc),
                            },
                        });
                    }
                },
                onSnapshot: ({ snapshot, version }) => {
                    if (!editorView || editorView.isDestroyed) return;
                    logHydration({
                        event: "note_remote_snapshot_received",
                        source: "remote_snapshot",
                        data: {
                            docId,
                            bytes: snapshot.byteLength,
                            version: version ?? null,
                        },
                    });
                    try {
                        const record = decodeRecordSnapshot({ data: snapshot });
                        if (
                            !snapshotRecordHasVisibleContent(record)
                            && editorView.state.doc.textContent.trim().length > 0
                            && !syncComplete
                        ) {
                            crdtDebugLog({
                                event: "remote_snapshot_skipped",
                                data: {
                                    docId,
                                    reason: "snapshot_empty_before_sync_complete",
                                    bytes: snapshot.byteLength,
                                },
                            });
                            return;
                        }
                        const result = applyRemoteSnapshot({
                            state: editorView.state,
                            plugin: capturedCrdtPlugin,
                            snapshotDoc: record.body,
                        });
                        const updated = updateEditorStateSafely(editorView, result.state, "remote_snapshot");
                        if (!updated) return;

                        const resolvedVersion = version ?? getRecordSnapshotVersion({ data: snapshot });
                        backendSnapshotVersionRef.current = resolvedVersion;
                        localSnapshotSeedRef.current = {
                            bytes: snapshot,
                            version: resolvedVersion,
                            stateVector: new Map(getRecordSnapshotStateVector({ data: snapshot })),
                        };

                        const markdown = tableMarkdownSerializer.serialize(result.state.doc);
                        updateContent(markdown);
                        scheduleSnapshotPersist("remote-merged");
                        logHydration({
                            event: "note_render_state",
                            source: "remote_snapshot",
                            data: {
                                docTextLen: result.state.doc.textContent.length,
                                markdownLen: markdown.length,
                            },
                        });
                        crdtDebugLog({
                            event: "remote_snapshot_applied",
                            data: {
                                docId,
                                bytes: snapshot.byteLength,
                                version: resolvedVersion,
                            },
                        });
                    } catch (error) {
                        crdtDebugLog({
                            event: "remote_snapshot_apply_failed",
                            level: "error",
                            data: {
                                docId,
                                error: summarizeErrorForDebug(error),
                            },
                        });
                    }
                },
                onSyncComplete: () => {
                    syncComplete = true;
                    logHydration({
                        event: "note_sync_complete",
                        source: "collab",
                        data: {
                            docId,
                            receivedRemoteOps,
                            pendingLocalOps: pendingLocalOps.length,
                            bootstrapQueued,
                        },
                    });
                    crdtDebugLog({
                        event: "sync_complete",
                        data: {
                            docId,
                            receivedRemoteOps,
                            pendingLocalOps: pendingLocalOps.length,
                            bootstrapQueued,
                        },
                    });

                    if (pendingLocalOps.length > 0) {
                        const opsToFlush = pendingLocalOps;
                        pendingLocalOps = [];
                        collab.sendOps({
                            docId,
                            ops: opsToFlush as ReadonlyArray<Operation>,
                        });
                        crdtDebugLog({
                            event: "presync_ops_flushed",
                            data: {
                                docId,
                                count: opsToFlush.length,
                                ops: summarizeOpsForDebug(opsToFlush),
                            },
                        });
                    }

                    maybeBootstrap();

                    if (!receivedRemoteOps && !bootstrapQueued && pendingLocalOps.length === 0) {
                        crdtDebugLog({
                            event: "bootstrap_retry_scheduled",
                            data: { docId, delayMs: BOOTSTRAP_CLAIM_TTL_MS + 250 },
                        });
                        bootstrapRetryTimer = setTimeout(() => {
                            maybeBootstrap();
                        }, BOOTSTRAP_CLAIM_TTL_MS + 250);
                    }
                },
            });

            // Subscribe to remote awareness updates (cursors)
            unsubscribeAwareness = collab.subscribeAwareness({
                docId,
                onAwareness: ({ clientId: remoteClientId, state: awarenessState }) => {
                    if (!editorView || editorView.isDestroyed) return;
                    if (remoteClientId === collab.clientId) return; // Skip self
                    const cursor = awarenessToRemoteCursor({
                        clientId: remoteClientId,
                        state: awarenessState,
                    });
                    if (cursor) {
                        remoteCursors.set(remoteClientId, cursor);
                    } else {
                        remoteCursors.delete(remoteClientId);
                    }
                    updateCollabRemoteCursors({
                        view: editorView,
                        cursors: remoteCursors,
                    });
                },
            });

            const previousUnsubscribeDoc = unsubscribeDoc;
            unsubscribeDoc = () => {
                clearBootstrapRetry();
                previousUnsubscribeDoc?.();
            };
        }

        // Helper to scroll to a specific line number with context above
        const scrollToLineNumber = (lineNum: number) => {
            const doc = editorView.state.doc;
            const linePositions: number[] = [0]; // Position of each line start (1-indexed, so [0] is unused)

            // Build array of line start positions
            doc.descendants((node, pos) => {
                if (node.isBlock && node.type.name !== "doc") {
                    linePositions.push(pos);
                }
                return true;
            });

            // Calculate scroll target (a few lines before the match for context)
            const contextLines = 5;
            const scrollTargetLine = Math.max(1, lineNum - contextLines);
            const scrollTargetPos = linePositions[scrollTargetLine] ?? 0;

            // Get the actual target position for cursor placement
            const targetPos = linePositions[lineNum] ?? linePositions[linePositions.length - 1] ?? 0;

            // First scroll the context line into view at the top
            const scrollTr = editorView.state.tr.setSelection(
                TextSelection.create(editorView.state.doc, scrollTargetPos)
            );
            editorView.dispatch(scrollTr.scrollIntoView());

            // Then set cursor at the actual target line (without scrolling again)
            requestAnimationFrame(() => {
                const cursorTr = editorView.state.tr.setSelection(
                    TextSelection.create(editorView.state.doc, targetPos)
                );
                editorView.dispatch(cursorTr);
            });
        };

        // Focus editor and handle cursor/scroll position
        if (autoFocus) {
            requestAnimationFrame(() => {
                try {
                    editorView.focus();
                    // If scrollToLine is specified, scroll to that line
                    if (scrollToLine && scrollToLine > 0) {
                        scrollToLineNumber(scrollToLine);
                    } else {
                        // Try to restore saved cursor position, otherwise place at start
                        restoreCursor(editorView);
                    }
                } catch {
                    // no-op if focusing fails
                }
            });
        } else {
            // Even without autoFocus, handle scroll position
            requestAnimationFrame(() => {
                try {
                    if (scrollToLine && scrollToLine > 0) {
                        scrollToLineNumber(scrollToLine);
                    } else {
                        restoreCursor(editorView);
                    }
                } catch {
                    // no-op
                }
            });
        }

        // Store ref value in variable for cleanup function
        const toolbarContainer = toolbarContainerRef.current;

        return () => {
            if (snapshotPersistTimer) {
                clearTimeout(snapshotPersistTimer);
                snapshotPersistTimer = null;
            }
            unregisterCmdEnter();
            unsubscribeDoc?.();
            unsubscribeAwareness?.();
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
            if (toolbarContainer) {
                toolbarContainer.innerHTML = "";
            }
            if (menubarObserverRef.current) {
                menubarObserverRef.current.disconnect();
                menubarObserverRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRichTextMode, noteFileName, hasNote, updateContent, saveImmediately, collab?.clientId, collabDocId]); // content and updateActiveHeadingFromCursor intentionally omitted to prevent editor recreation

    useEffect(() => {
        if (loading || error || !note || !isRichTextMode) return;
        if (viewRef.current) return;
        logHydration({
            event: "note_editor_view_missing_after_load",
            source: "editor_effect",
            data: {
                hasEditorRef: Boolean(editorRef.current),
                noteFileNameFromState: note.fileName,
                expectedNoteFileName: noteFileName,
                contentLen: note.content.length,
            },
        });
    }, [loading, error, note, isRichTextMode, noteFileName, logHydration]);

    // Update editor content when content changes externally (only after initial load)
    // In collab mode, CRDT handles doc sync, so skip external content updates.
    useEffect(() => {
        if (!viewRef.current || !isRichTextMode || !hasNote) return;
        if (hasCollab) return; // CRDT manages document state in team mode

        // Skip if this is the content we just initialized with
        if (content === initializedContentRef.current) return;

        // Only update if the markdown content is different from what's in the editor
        const currentMarkdown = tableMarkdownSerializer.serialize(viewRef.current.state.doc);
        if (currentMarkdown !== content) {
            const doc = tableMarkdownParser.parse(content || "") || tableSchema.nodes.doc.createAndFill();

            // Recreate the custom keymap for consistency
            const listIndentKeymap = keymap({
                "Tab": chainCommands(sinkListItem(tableSchema.nodes.list_item), wrapInList(tableSchema.nodes.bullet_list)),
                "Shift-Tab": liftListItem(tableSchema.nodes.list_item),
            });

            // Wiki link plugin for [[note]] suggestions
            const wikiLinkPlugin = createWikiLinkPlugin({
                schema: tableSchema,
                onStateChange: setWikiLinkState,
            });

            // Tag link plugin for #tag suggestions
            const tagLinkPlugin = createTagLinkPlugin({
                onStateChange: setTagLinkState,
            });

            // Tag decoration plugin for styling completed tags and atomic deletion
            const tagDecorationPlugin = createTagDecorationPlugin();

            // Search plugin for CMD+F functionality
            const searchPlugin = createSearchPlugin();

            // Spellcheck plugin for spell checking
            const spellcheckPlugin = createSpellcheckPlugin();
            const suggestionInlineActionsPlugin = createSuggestionInlineActionsPlugin({
                onDecision: applySuggestionDecision,
            });

            let newState = EditorState.create({
                doc,
                plugins: [
                    ...getTablePlugins(), // Table navigation must come BEFORE exampleSetup
                    todoKeymap, // Todo Enter handling must come BEFORE exampleSetup's Enter handler
                    ...exampleSetup({ schema: tableSchema, floatingMenu: false }),
                    listIndentKeymap,
                    todoPlugin,
                    wikiLinkPlugin,
                    tagLinkPlugin,
                    tagDecorationPlugin,
                    suggestionInlineActionsPlugin,
                    searchPlugin, // Search highlighting
                    spellcheckPlugin, // Spellcheck
                ],
            });

            // Apply table fixes to ensure proper table structure
            const fixTransaction = fixTables(newState);
            if (fixTransaction) {
                newState = newState.apply(fixTransaction);
            }

            // Normalize table column counts
            const normalizeTransaction = normalizeTableColumns(newState);
            if (normalizeTransaction) {
                newState = newState.apply(normalizeTransaction);
            }

            viewRef.current.updateState(newState);
            initializedContentRef.current = content;
        }
    }, [content, isRichTextMode, hasNote, hasCollab, applySuggestionDecision]);

    // Move ProseMirror menubar into the header toolbar container
    useEffect(() => {
        if (!isRichTextMode || !note) return;
        const mountNode = editorRef.current;
        const headerTarget = toolbarContainerRef.current;
        if (!mountNode || !headerTarget) return;

        const attemptMove = () => {
            const menubar = mountNode.querySelector(".ProseMirror-menubar") as HTMLElement | null;
            if (menubar && headerTarget) {
                headerTarget.innerHTML = "";
                headerTarget.appendChild(menubar);
                menubar.style.position = "static";
                menubar.style.top = "";
                menubar.style.background = "transparent";
                menubar.style.border = "0";
                return true;
            }
            return false;
        };

        if (!attemptMove()) {
            if (menubarObserverRef.current) menubarObserverRef.current.disconnect();
            const observer = new MutationObserver((_mutations) => {
                const menubar = mountNode.querySelector(".ProseMirror-menubar") as HTMLElement | null;
                if (menubar && menubar.parentElement === mountNode && attemptMove()) {
                    observer.disconnect();
                    menubarObserverRef.current = null;
                }
            });
            observer.observe(mountNode, { childList: true, subtree: true });
            menubarObserverRef.current = observer;
        }

        return () => {
            if (menubarObserverRef.current) {
                menubarObserverRef.current.disconnect();
                menubarObserverRef.current = null;
            }
        };
    }, [isRichTextMode, note]);

    // Clean up timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Focus editor when tab becomes active (for tab switching)
    useEffect(() => {
        if (activeTab?.id === tabId && autoFocus && viewRef.current) {
            // Small delay to ensure the tab transition is complete
            requestAnimationFrame(() => {
                try {
                    viewRef.current?.focus();
                } catch {
                    // no-op if focusing fails
                }
            });
        }
    }, [activeTab?.id, tabId, autoFocus]);

    // Check for external changes when tab becomes active (not on initial mount)
    useEffect(() => {
        const wasActive = prevActiveTabIdRef.current === tabId;
        const isActive = activeTab?.id === tabId;
        prevActiveTabIdRef.current = activeTab?.id;

        // Only check when transitioning from inactive to active
        if (!isActive || wasActive) return;
        if (!noteFileName) return;
        // Skip if we don't have an mtime yet (initial load still in progress)
        if (lastKnownMtimeRef.current === null) return;

        const checkForExternalChanges = async () => {
            try {
                const { mtime: currentMtime } = await notesAPI.getNoteMtime({ fileName: noteFileName });
                const lastKnownMtime = lastKnownMtimeRef.current;

                // No change detected
                if (currentMtime === lastKnownMtime) return;
                if (currentMtime === null) return; // File was deleted

                // Get current editor content
                const currentEditorContent = viewRef.current
                    ? tableMarkdownSerializer.serialize(viewRef.current.state.doc)
                    : content;

                const hasUnsavedEdits = currentEditorContent !== lastSavedContentRef.current;

                if (hasUnsavedEdits) {
                    // Show conflict toast
                    toast("Note was modified externally", {
                        duration: Infinity,
                        action: {
                            label: "Reload",
                            onClick: async () => {
                                // Reload the note from disk
                                const freshNote = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });
                                const freshContent = freshNote?.content || "";
                                setNote(freshNote);
                                setContent(freshContent);
                                setHeadings(parseHeadings(freshContent));
                                lastSavedContentRef.current = freshContent;
                                lastKnownMtimeRef.current = freshNote?.mtime ?? null;
                                initializedContentRef.current = freshContent;

                                // Update editor if it exists
                                if (viewRef.current) {
                                    const doc = tableMarkdownParser.parse(freshContent) || tableSchema.nodes.doc.createAndFill();
                                    const stateWithNewDoc = EditorState.create({
                                        doc,
                                        plugins: viewRef.current.state.plugins,
                                        selection: Selection.atStart(doc!),
                                    });
                                    viewRef.current.updateState(stateWithNewDoc);
                                }

                                // Update tags and project from front matter
                                const noteTags = freshNote?.frontMatter?.tags;
                                if (Array.isArray(noteTags)) {
                                    setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                                } else {
                                    setTags([]);
                                }
                                const noteProject = freshNote?.frontMatter?.project;
                                if (typeof noteProject === "string") {
                                    setProject(noteProject);
                                } else {
                                    setProject(null);
                                }
                            },
                        },
                        cancel: {
                            label: "Keep mine",
                            onClick: () => {
                                // Just update the mtime ref to suppress future warnings until next external change
                                lastKnownMtimeRef.current = currentMtime;
                            },
                        },
                    });
                } else {
                    // No unsaved edits - silently refresh
                    const freshNote = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });
                    const freshContent = freshNote?.content || "";
                    setNote(freshNote);
                    setContent(freshContent);
                    setHeadings(parseHeadings(freshContent));
                    lastSavedContentRef.current = freshContent;
                    lastKnownMtimeRef.current = freshNote?.mtime ?? null;
                    initializedContentRef.current = freshContent;

                    // Update editor if it exists
                    if (viewRef.current) {
                        const doc = tableMarkdownParser.parse(freshContent) || tableSchema.nodes.doc.createAndFill();
                        const stateWithNewDoc = EditorState.create({
                            doc,
                            plugins: viewRef.current.state.plugins,
                            selection: Selection.atStart(doc!),
                        });
                        viewRef.current.updateState(stateWithNewDoc);
                    }

                    // Update tags and project from front matter
                    const noteTags = freshNote?.frontMatter?.tags;
                    if (Array.isArray(noteTags)) {
                        setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                    } else {
                        setTags([]);
                    }
                    const noteProject = freshNote?.frontMatter?.project;
                    if (typeof noteProject === "string") {
                        setProject(noteProject);
                    } else {
                        setProject(null);
                    }
                }
            } catch (error) {
                console.error("Failed to check for external changes:", error);
            }
        };

        checkForExternalChanges();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab?.id, tabId, noteFileName]); // Only run on tab activation, not on content changes

    // Add scroll listener to track current section (when cursor isn't moving)
    useEffect(() => {
        if (!editorRef.current || !isRichTextMode) return;

        const editor = editorRef.current.querySelector(".ProseMirror");
        if (!editor) return;

        const handleScroll = () => {
            // Only update from scroll if we're not actively typing/moving cursor
            updateActiveHeadingFromScroll();
        };

        editor.addEventListener("scroll", handleScroll);
        // Also listen to window scroll in case the container scrolls
        window.addEventListener("scroll", handleScroll);

        // Initial check based on cursor position
        if (viewRef.current) {
            updateActiveHeadingFromCursor();
        } else {
            updateActiveHeadingFromScroll();
        }

        return () => {
            editor.removeEventListener("scroll", handleScroll);
            window.removeEventListener("scroll", handleScroll);
        };
    }, [isRichTextMode, updateActiveHeadingFromScroll, updateActiveHeadingFromCursor]);

    // Keyboard navigation for mini-map and search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // CMD+F to open search
            if ((e.metaKey || e.ctrlKey) && e.key === "f") {
                e.preventDefault();
                setIsSearchOpen(true);
                return;
            }

            // CMD+/ to focus mini-map
            if ((e.metaKey || e.ctrlKey) && e.key === "/") {
                e.preventDefault();
                setIsMinimapFocused(true);
                minimapRef.current?.focus();

                // Set focused index to current active heading
                const currentIndex = headings.findIndex((h) => h.id === activeHeadingId);
                if (currentIndex !== -1) {
                    setFocusedHeadingIndex(currentIndex);
                }
                return;
            }

            // Navigation when mini-map is focused
            if (isMinimapFocused && headings.length > 0) {
                switch (e.key) {
                    case "ArrowUp":
                        e.preventDefault();
                        {
                            const newIndex = focusedHeadingIndex === 0 ? headings.length - 1 : focusedHeadingIndex - 1;
                            setFocusedHeadingIndex(newIndex);
                            // Scroll to preview the heading
                            if (headings[newIndex]) {
                                scrollToHeadingPreview(headings[newIndex].id);
                            }
                        }
                        break;
                    case "ArrowDown":
                        e.preventDefault();
                        {
                            const newIndex = focusedHeadingIndex === headings.length - 1 ? 0 : focusedHeadingIndex + 1;
                            setFocusedHeadingIndex(newIndex);
                            // Scroll to preview the heading
                            if (headings[newIndex]) {
                                scrollToHeadingPreview(headings[newIndex].id);
                            }
                        }
                        break;
                    case "Home":
                        e.preventDefault();
                        setFocusedHeadingIndex(0);
                        break;
                    case "End":
                        e.preventDefault();
                        setFocusedHeadingIndex(headings.length - 1);
                        break;
                    case "Enter":
                    case " ": // Also allow Space to jump
                        e.preventDefault();
                        if (headings[focusedHeadingIndex]) {
                            scrollToHeading(headings[focusedHeadingIndex].id);
                        }
                        break;
                    case "Escape":
                        e.preventDefault();
                        setIsMinimapFocused(false);
                        viewRef.current?.focus();
                        break;
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isMinimapFocused, headings, focusedHeadingIndex, activeHeadingId, scrollToHeading, scrollToHeadingPreview]);

    // Single OverlayScrollbar stays mounted across all states for scroll persistence
    return (
        <div className="h-full overflow-hidden flex flex-col">
            {/* Header: only visible when content is loaded */}
            {!loading && !error && note && (
                <div
                    className="shrink-0"
                    style={{
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderBottom: `1px solid ${currentTheme.styles.borderDefault}`,
                    }}
                >
                    <div className="px-4 py-2 flex items-center gap-3">
                        <div className="flex flex-col items-start gap-1 min-w-0">
                            {/* Breadcrumb for folder path */}
                            {(() => {
                                const pathWithoutExt = noteFileName.replace(/\.md$/, "");
                                const parts = pathWithoutExt.split("/");
                                const fileName = parts.pop() || pathWithoutExt;
                                const folderPath = parts;

                                return (
                                    <>
                                        {folderPath.length > 0 && (
                                            <Breadcrumb>
                                                <BreadcrumbList className="text-xs">
                                                    {folderPath.map((folder, index) => (
                                                        <BreadcrumbItem key={index}>
                                                            <span style={{ color: currentTheme.styles.contentTertiary }}>
                                                                {folder}
                                                            </span>
                                                            {index < folderPath.length - 1 && <BreadcrumbSeparator />}
                                                        </BreadcrumbItem>
                                                    ))}
                                                </BreadcrumbList>
                                            </Breadcrumb>
                                        )}
                                        <div
                                            className="text-3xl font-bold"
                                            style={{ color: currentTheme.styles.contentPrimary }}
                                        >
                                            {fileName}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Project and Tags row */}
                    <div className="px-4 pb-2 flex items-center gap-4">
                        <ProjectInput project={project} onProjectChange={handleProjectChange} />
                        <TagInput tags={tags} onTagsChange={handleTagsChange} placeholder="Add tag..." />
                    </div>

                </div>
            )}

            {/* Main content area with flex layout */}
            <div className="flex-1 overflow-hidden flex min-h-0">
                {/* Main scrollable area */}
                <div className="flex-1 h-full relative">
                    {/* Search Panel - only visible when content is loaded */}
                    {!loading && !error && note && viewRef.current && (
                        <SearchPanel
                            view={viewRef.current}
                            isOpen={isSearchOpen}
                            onClose={() => setIsSearchOpen(false)}
                        />
                    )}

                    {/* Single OverlayScrollbar - always mounted to preserve scroll position */}
                    <OverlayScrollbar
                        scrollRef={scrollRef}
                        className="flex-1 h-full"
                        style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
                    >
                        {(loading || !note) ? (
                            // Loading placeholder
                            <div className="h-full" />
                        ) : error ? (
                            // Error state
                            <div className="p-4">
                                <Alert variant="destructive">
                                    <AlertDescription>Error: {error}</AlertDescription>
                                </Alert>
                            </div>
                        ) : isRichTextMode ? (
                            // Rich text editor
                            <div className={compact ? 'compact-editor' : ''}>
                                <div className="w-full max-w-4xl mx-auto px-6 py-4">
                                    <div
                                        ref={editorRef}
                                        className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none focus:outline-none editor-content"
                                        style={
                                            {
                                                "--tw-prose-body": currentTheme.styles.contentPrimary,
                                                "--tw-prose-headings": currentTheme.styles.contentPrimary,
                                                "--tw-prose-links": currentTheme.styles.contentAccent,
                                                "--tw-prose-bold": currentTheme.styles.contentPrimary,
                                                "--tw-prose-counters": currentTheme.styles.contentSecondary,
                                                "--tw-prose-bullets": currentTheme.styles.contentSecondary,
                                                "--tw-prose-hr": currentTheme.styles.borderDefault,
                                                "--tw-prose-quotes": currentTheme.styles.contentPrimary,
                                                "--tw-prose-quote-borders": currentTheme.styles.borderDefault,
                                                "--tw-prose-captions": currentTheme.styles.contentSecondary,
                                                "--tw-prose-code": currentTheme.styles.contentPrimary,
                                                "--tw-prose-pre-code": currentTheme.styles.contentPrimary,
                                                "--tw-prose-pre-bg": currentTheme.styles.surfaceMuted,
                                                "--tw-prose-th-borders": currentTheme.styles.borderDefault,
                                                "--tw-prose-td-borders": currentTheme.styles.borderDefault,
                                                // Todo checkbox theme variables
                                                "--todo-border": currentTheme.styles.borderDefault,
                                                "--todo-bg": currentTheme.styles.surfacePrimary,
                                                "--todo-checked-bg": currentTheme.styles.semanticPrimary,
                                                "--todo-checked-fg": currentTheme.styles.semanticPrimaryForeground,
                                                "--todo-completed-text": currentTheme.styles.contentTertiary,
                                                // Tag theme variables
                                                "--tag-color": currentTheme.styles.contentAccent,
                                                "--tag-hover-bg": currentTheme.styles.surfaceAccent,
                                                color: currentTheme.styles.contentPrimary,
                                            } as React.CSSProperties
                                        }
                                    />
                                    {/* Wiki link popup */}
                                    {viewRef.current &&
                                        wikiLinkState.active &&
                                        viewRef.current.hasFocus() &&
                                        typeof document !== "undefined" &&
                                        document.hasFocus() && (
                                        <WikiLinkPopup
                                            view={viewRef.current}
                                            pluginState={wikiLinkState}
                                        />
                                    )}
                                    {/* Tag link popup */}
                                    {viewRef.current && tagLinkState.active && (
                                        <TagLinkPopup
                                            view={viewRef.current}
                                            pluginState={tagLinkState}
                                        />
                                    )}
                                    {/* Spellcheck popup - handles hover internally */}
                                    {viewRef.current && (
                                        <SpellcheckPopup view={viewRef.current} />
                                    )}
                                </div>
                            </div>
                        ) : (
                            // Plain text editor
                            <div className="h-full bg-background">
                                <div className="w-full max-w-4xl mx-auto px-6 py-4">
                                    <textarea
                                        value={content}
                                        onChange={(e) => updateContent(e.target.value)}
                                        onBlur={() => saveImmediately(content)}
                                        placeholder="Write your markdown here..."
                                        className="w-full h-full min-h-[calc(100vh-200px)] bg-transparent border-0 resize-none font-mono text-sm focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground"
                                        autoFocus
                                    />
                                </div>
                            </div>
                        )}
                    </OverlayScrollbar>
                </div>

                {/* Sidebar with TOC and Backlinks - only visible when content is loaded */}
                {!loading && !error && note && isRichTextMode && !compact && SHOW_NOTES_RIGHT_SIDEBAR && (
                    <div
                        ref={minimapRef}
                        tabIndex={-1}
                        className={cn(
                            "w-48 shrink-0 border-l focus:outline-none transition-colors",
                            isMinimapFocused && "bg-accent/20"
                        )}
                        style={{
                            borderColor: currentTheme.styles.borderDefault,
                            backgroundColor: currentTheme.styles.surfacePrimary,
                        }}
                        onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget)) {
                                setIsMinimapFocused(false);
                            }
                        }}
                    >
                        <OverlayScrollbar className="h-full">
                            <div className="p-3 pt-4 space-y-4">
                            {/* Table of Contents (On This Page) */}
                            {headings.length > 0 && (
                                <CollapsibleSection title="On This Page" count={headings.length} defaultOpen={true}>
                                    <nav
                                        ref={(el) => {
                                            // Auto-scroll to keep focused item in view
                                            if (el && isMinimapFocused && focusedHeadingIndex >= 0) {
                                                const buttons = el.querySelectorAll('button');
                                                const focusedButton = buttons[focusedHeadingIndex];
                                                if (focusedButton) {
                                                    focusedButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
                                                }
                                            }
                                        }}
                                    >
                                        {isMinimapFocused && (
                                            <div className="flex justify-end mb-1">
                                                <span className="text-[9px] px-1 py-0.5 rounded bg-accent" style={{ color: currentTheme.styles.contentSecondary }}>
                                                    ↑↓
                                                </span>
                                            </div>
                                        )}
                                        {headings.map((heading, index) => {
                                            const isActive = activeHeadingId === heading.id;
                                            const isFocused = isMinimapFocused && index === focusedHeadingIndex;

                                            return (
                                                <button
                                                    key={`${heading.id}-${index}`}
                                                    onClick={() => {
                                                        scrollToHeading(heading.id);
                                                        setFocusedHeadingIndex(index);
                                                    }}
                                                    className={cn(
                                                        "w-full text-left px-2 py-1 rounded text-xs transition-colors truncate",
                                                        heading.level === 1 && "font-medium",
                                                        heading.level === 2 && "pl-4",
                                                        heading.level >= 3 && "pl-6 opacity-70",
                                                        !isActive && !isFocused && "hover:bg-accent/50",
                                                        isActive && !isFocused && "font-medium",
                                                        isFocused && "bg-accent ring-1 ring-primary/50"
                                                    )}
                                                    style={{
                                                        color: isFocused ? currentTheme.styles.contentPrimary : (isActive ? currentTheme.styles.contentAccent : currentTheme.styles.contentSecondary),
                                                    }}
                                                >
                                                    {heading.text}
                                                </button>
                                            );
                                        })}
                                    </nav>
                                </CollapsibleSection>
                            )}

                            {/* Backlinks Panel */}
                            <BacklinksPanel
                                noteFileName={noteFileName}
                                onOpenNote={(fileName) => {
                                    openTab({
                                        pluginMeta: { id: "notes", name: "Notes", icon: "file" },
                                        view: "editor",
                                        props: { noteFileName: fileName },
                                    });
                                }}
                                onCreateNote={async (noteName) => {
                                    // Create the note and open it
                                    const newFileName = `${noteName}.md`;
                                    await notesAPI.createNote({ fileName: newFileName, content: `# ${noteName}\n\n` });
                                    openTab({
                                        pluginMeta: { id: "notes", name: "Notes", icon: "file" },
                                        view: "editor",
                                        props: { noteFileName: newFileName },
                                    });
                                }}
                            />
                            </div>
                        </OverlayScrollbar>
                    </div>
                )}
            </div>
        </div>
    );
}

export default NotesView;
