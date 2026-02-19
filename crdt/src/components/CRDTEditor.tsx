import { useEffect, useRef, useState, useCallback } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema } from "prosemirror-model";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import type { Operation } from "@/crdt/core/operations";
import type { CRDTDoc } from "@/crdt/core/apply-operations";
import {
  createCRDTPlugin,
  applyRemoteOps,
  undoCommand,
  redoCommand,
  getCRDTState,
  type CRDTPluginState,
} from "@/crdt/prosemirror/plugin";
import type { Plugin } from "prosemirror-state";
import type { RecordOp } from "@/crdt/document/record";
import {
  createCursorPlugin,
  updateRemoteCursors,
  awarenessToRemoteCursor,
  type RemoteCursor,
} from "@/crdt/prosemirror/cursor-decorations";
import type { AwarenessState } from "@/crdt/network/awareness";
import { useCRDT } from "@/hooks/useCRDT";
import { colorForClient } from "@/hooks/CRDTProvider";

// Assign each editor a stable color based on its position
const CURSOR_COLORS = ["#e06c75", "#61afef", "#98c379", "#c678dd", "#e5c07b"];

type ConnectionState = "connected" | "offline" | "syncing";

function logToServer(params: { editor: string; event: string; detail: string }) {
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      editor: params.editor,
      event: params.event,
      detail: params.detail,
    }),
  }).catch(() => {});
}

export const editorSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM() { return ["p", 0]; },
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline", inline: true },
  },
  marks: {
    bold: {
      toDOM() {
        return ["strong", 0];
      },
      parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }],
    },
    italic: {
      toDOM() {
        return ["em", 0];
      },
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
    },
    underline: {
      toDOM() {
        return ["u", 0];
      },
      parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }],
    },
    strikethrough: {
      toDOM() {
        return ["s", 0];
      },
      parseDOM: [{ tag: "s" }, { tag: "del" }, { style: "text-decoration=line-through" }],
    },
    code: {
      toDOM() {
        return ["code", 0];
      },
      parseDOM: [{ tag: "code" }],
    },
    suggestion: {
      attrs: { id: { default: "" }, action: { default: "insert" } },
      inclusive: false,
      toDOM(mark) {
        const isInsert = mark.attrs.action === "insert";
        return ["span", {
          class: isInsert ? "suggestion-insert" : "suggestion-delete",
          "data-suggestion-id": mark.attrs.id,
          style: isInsert
            ? "background: rgba(34,197,94,0.2)"
            : "background: rgba(239,68,68,0.2); text-decoration: line-through",
        }, 0];
      },
      parseDOM: [{ tag: "span[data-suggestion-id]", getAttrs(dom) {
        if (typeof dom === "string") return false;
        return {
          id: dom.getAttribute("data-suggestion-id") ?? "",
          action: dom.classList.contains("suggestion-insert") ? "insert" : "delete",
        };
      }}],
    },
  },
});

const FORMAT_BUTTONS = [
  { mark: "bold", label: "B", title: "Bold (Cmd+B)", style: "font-bold" },
  { mark: "italic", label: "I", title: "Italic (Cmd+I)", style: "italic" },
  { mark: "underline", label: "U", title: "Underline (Cmd+U)", style: "underline" },
  { mark: "strikethrough", label: "S", title: "Strikethrough (Cmd+Shift+X)", style: "line-through" },
  { mark: "code", label: "<>", title: "Code (Cmd+E)", style: "font-mono text-xs" },
] as const;

function FormatToolbar(params: {
  activeMarks: Set<string>;
  onToggleMark: (mark: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b px-2 py-1">
      {FORMAT_BUTTONS.map((btn) => (
        <button
          key={btn.mark}
          type="button"
          title={btn.title}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent stealing focus from editor
            params.onToggleMark(btn.mark);
          }}
          className={`inline-flex items-center justify-center h-7 w-7 rounded text-sm ${btn.style} ${
            params.activeMarks.has(btn.mark)
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          }`}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

interface CRDTEditorProps {
  label: string;
  docId: string;
  initialDoc?: CRDTDoc;
}

export function CRDTEditor(params: CRDTEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pluginRef = useRef<Plugin<CRDTPluginState> | null>(null);
  const remoteCursorsRef = useRef<Map<string, RemoteCursor>>(new Map());
  const { clientId, sendOps, sendAwareness, subscribeDoc, subscribeAwareness, disconnect, reconnect, pendingOpsCount, isConnected: providerConnected } = useCRDT();
  const [connectionState, setConnectionState] = useState<ConnectionState>("syncing");
  const [opCount, setOpCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [activeMarks, setActiveMarks] = useState<Set<string>>(new Set());

  // Stable ref for sendOps so the ProseMirror plugin callback doesn't go stale
  const sendOpsRef = useRef(sendOps);
  sendOpsRef.current = sendOps;
  const sendAwarenessRef = useRef(sendAwareness);
  sendAwarenessRef.current = sendAwareness;
  const pendingOpsCountRef = useRef(pendingOpsCount);
  pendingOpsCountRef.current = pendingOpsCount;

  // Track provider connection for syncing display
  useEffect(() => {
    if (!providerConnected) {
      setConnectionState("offline");
    }
  }, [providerConnected]);

  useEffect(() => {
    if (!editorRef.current) return;

    const plugin = createCRDTPlugin({
      clientId,
      schema: editorSchema,
      initialDoc: params.initialDoc,
      onLocalOps: (ops) => {
        sendOpsRef.current({ docId: params.docId, ops: ops as ReadonlyArray<RecordOp> });
        setOpCount((c) => c + ops.length);
        setPendingCount(pendingOpsCountRef.current());
      },
    });
    pluginRef.current = plugin;

    const cursorPlugin = createCursorPlugin({ localClientId: clientId });

    const undoKeymap = keymap({
      "Mod-z": (state) => {
        const result = undoCommand({ state, plugin });
        if (!result) return false;
        viewRef.current?.updateState(result.state);
        sendOpsRef.current({ docId: params.docId, ops: result.ops as ReadonlyArray<RecordOp> });
        setPendingCount(pendingOpsCountRef.current());
        return true;
      },
      "Mod-y": (state) => {
        const result = redoCommand({ state, plugin });
        if (!result) return false;
        viewRef.current?.updateState(result.state);
        sendOpsRef.current({ docId: params.docId, ops: result.ops as ReadonlyArray<RecordOp> });
        setPendingCount(pendingOpsCountRef.current());
        return true;
      },
      "Mod-Shift-z": (state) => {
        const result = redoCommand({ state, plugin });
        if (!result) return false;
        viewRef.current?.updateState(result.state);
        sendOpsRef.current({ docId: params.docId, ops: result.ops as ReadonlyArray<RecordOp> });
        setPendingCount(pendingOpsCountRef.current());
        return true;
      },
    });

    const formatKeymap = keymap({
      "Mod-b": toggleMark(editorSchema.marks["bold"]!),
      "Mod-i": toggleMark(editorSchema.marks["italic"]!),
      "Mod-u": toggleMark(editorSchema.marks["underline"]!),
      "Mod-Shift-x": toggleMark(editorSchema.marks["strikethrough"]!),
      "Mod-e": toggleMark(editorSchema.marks["code"]!),
    });

    const state = EditorState.create({
      schema: editorSchema,
      plugins: [undoKeymap, formatKeymap, plugin, cursorPlugin, keymap(baseKeymap)],
    });

    // Pick a color based on clientId hash
    const colorIndex = Math.abs(hashCode(clientId)) % CURSOR_COLORS.length;
    const myColor = CURSOR_COLORS[colorIndex]!;

    // Log keystrokes
    const handleKeyDown = (e: KeyboardEvent) => {
      const mods = [e.metaKey && "Cmd", e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt"].filter(Boolean).join("+");
      const keyDesc = mods ? `${mods}+${e.key}` : e.key;
      logToServer({ editor: params.label, event: "KEY", detail: keyDesc });
    };
    editorRef.current.addEventListener("keydown", handleKeyDown);

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        // Log document changes
        if (tr.docChanged) {
          const steps = tr.steps.map((s) => JSON.stringify(s.toJSON()));
          const sel = newState.selection;
          logToServer({
            editor: params.label,
            event: "CHANGE",
            detail: `sel=${sel.anchor}-${sel.head} steps=${steps.join(" | ")} doc="${newState.doc.textContent}"`,
          });
        }

        // Update active marks for toolbar
        const marks = new Set<string>();
        const storedMarks = newState.storedMarks ?? newState.selection.$from.marks();
        for (const mark of storedMarks) {
          marks.add(mark.type.name);
        }
        setActiveMarks(marks);

        // Send awareness update on selection change
        if (tr.selectionSet || tr.docChanged) {
          const sel = newState.selection;
          sendAwarenessRef.current({
            docId: params.docId,
            state: {
              cursor: { anchor: sel.anchor, head: sel.head },
              user: { name: clientId.slice(0, 8), color: myColor },
              lastUpdated: Date.now(),
            },
          });
        }
      },
    });
    viewRef.current = view;

    // Subscribe to document ops via context (ref-counted)
    const unsubDoc = subscribeDoc({
      docId: params.docId,
      initialStateVector: params.initialDoc?.stateVector,
      onOps: ({ docId, ops }: { docId: string; ops: ReadonlyArray<RecordOp> }) => {
        if (docId !== params.docId) return;
        if (!viewRef.current || !pluginRef.current) return;

        // Filter to body ops only (insert/delete/format) for ProseMirror
        const bodyOps = ops.filter(
          (op): op is Operation => op.type === "insert" || op.type === "delete" || op.type === "format"
        );
        if (bodyOps.length === 0) return;

        logToServer({
          editor: params.label,
          event: "REMOTE_OPS",
          detail: `count=${bodyOps.length} types=${bodyOps.map((o) => o.type).join(",")}`,
        });
        const currentState = viewRef.current.state;
        const result = applyRemoteOps({
          state: currentState,
          plugin: pluginRef.current,
          ops: bodyOps,
        });
        viewRef.current.updateState(result.state);
        logToServer({
          editor: params.label,
          event: "AFTER_REMOTE",
          detail: `doc="${result.state.doc.textContent}"`,
        });
      },
      onSyncComplete: ({ docId }) => {
        if (docId === params.docId) {
          setConnectionState("connected");
          setPendingCount(0);
        }
      },
    });

    // Subscribe to awareness on this docId via context
    const unsubAwareness = subscribeAwareness({
      docId: params.docId,
      onAwareness: ({ docId, clientId: remoteClientId, state: awarenessState }) => {
        if (docId !== params.docId) return;
        if (!viewRef.current) return;
        const cursor = awarenessToRemoteCursor({
          clientId: remoteClientId,
          state: awarenessState,
        });
        if (!cursor) {
          remoteCursorsRef.current.delete(remoteClientId);
        } else {
          remoteCursorsRef.current.set(remoteClientId, cursor);
        }
        updateRemoteCursors({
          view: viewRef.current,
          cursors: new Map(remoteCursorsRef.current),
        });
      },
    });

    // Set initial connection state based on whether provider is already connected
    if (providerConnected) {
      setConnectionState("syncing");
    }

    return () => {
      editorRef.current?.removeEventListener("keydown", handleKeyDown);
      unsubDoc();
      unsubAwareness();
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const handleToggleMark = useCallback((markName: string) => {
    const view = viewRef.current;
    if (!view) return;
    const markType = editorSchema.marks[markName];
    if (!markType) return;
    toggleMark(markType)(view.state, view.dispatch);
    view.focus();
  }, []);

  const handleToggleConnection = useCallback(() => {
    if (connectionState === "connected" || connectionState === "syncing") {
      disconnect();
      setConnectionState("offline");
      setPendingCount(0);
    } else {
      reconnect();
    }
  }, [connectionState, disconnect, reconnect]);

  const statusDot =
    connectionState === "connected" ? "bg-green-500" :
    connectionState === "syncing" ? "bg-yellow-500" :
    "bg-red-500";

  const statusLabel =
    connectionState === "connected" ? "Connected" :
    connectionState === "syncing" ? "Syncing..." :
    "Offline";

  return (
    <div className="flex flex-col gap-2" data-editor={params.label}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{params.label}</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} />
          <span>{statusLabel}</span>
          {connectionState === "offline" && pendingCount > 0 && (
            <span>{pendingCount} pending</span>
          )}
          <span>|</span>
          <span>{clientId.slice(0, 8)}</span>
          <span>|</span>
          <span>{opCount} ops</span>
          <span>|</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleToggleConnection}
            disabled={connectionState === "syncing"}
            className="underline hover:no-underline disabled:opacity-50 disabled:no-underline"
          >
            {connectionState === "connected" ? "Go Offline" :
             connectionState === "syncing" ? "Syncing..." :
             "Go Online"}
          </button>
        </div>
      </div>
      <div className="border rounded-md focus-within:ring-1 focus-within:ring-ring">
        <FormatToolbar activeMarks={activeMarks} onToggleMark={handleToggleMark} />
        <div
          ref={editorRef}
          className="prose prose-sm max-w-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[180px] [&_.ProseMirror]:p-3"
        />
      </div>
    </div>
  );
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}
