// React/browser sub-entry point: @crdt/lib/react

// Context provider
export { CRDTProvider, colorForClient } from "../hooks/CRDTProvider";
export type { CRDTContextValue, OpsListener, AwarenessListener, SyncCompleteListener } from "../hooks/CRDTProvider";

// Context hooks
export { useCRDT, useClientId, useTransport } from "../hooks/useCRDT";

// Presence hooks
export { usePresenceByDoc, useSendPresence } from "../hooks/usePresence";

// Kanban hook
export { useKanbanCRDT } from "../hooks/useKanbanCRDT";

// Transport (WebSocket client)
export { createMultiDocTransport } from "./network/multi-doc-transport";
export type { MultiDocTransport } from "./network/multi-doc-transport";

// ProseMirror plugin + helpers
export { createCRDTPlugin, getCRDTState, applyRemoteOps, undoCommand, redoCommand } from "./prosemirror/plugin";
export type { CRDTPluginState } from "./prosemirror/plugin";
export { crdtToProseMirror, proseMirrorPositionToCRDT } from "./prosemirror/state-mapping";
export type { CRDTPosition } from "./prosemirror/state-mapping";
export { transactionToCRDTOps } from "./prosemirror/transaction-capture";
export { createCursorPlugin, updateRemoteCursors, awarenessToRemoteCursor } from "./prosemirror/cursor-decorations";
export type { RemoteCursor } from "./prosemirror/cursor-decorations";

// Awareness
export {
  createAwareness,
  setLocalState,
  applyRemoteState,
  removeStaleStates,
  getStates,
  encodeAwareness,
  decodeAwareness,
} from "./network/awareness";
export type { Awareness, AwarenessState, CursorPosition, UserInfo } from "./network/awareness";
