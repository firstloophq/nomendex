// CRDT library entry point

// Core
export { createClock, increment, receive, compareTimestamps } from "./core/lamport-clock";
export type { LamportClock, Timestamp, ClientId } from "./core/lamport-clock";
export { generateClientId } from "./core/client-id";
export {
  createOperationId,
  operationIdEquals,
  createInsertOp,
  createDeleteOp,
  createFormatOp,
  createAttrUpdateOp,
  createReparentOp,
} from "./core/operations";
export type {
  OperationId,
  Operation,
  InsertOp,
  DeleteOp,
  FormatOp,
  AttrUpdateOp,
  ReparentOp,
  Content,
  TextContent,
  BlockContent,
  InlineAtomContent,
  Mark,
} from "./core/operations";
export { createItemStore, integrateItem, deleteItem, getItemById, getVisibleContent } from "./core/item";
export type { Item, ItemStore } from "./core/item";
export {
  createEmptyDocument,
  applyOperation,
  applyOperations,
  getDocumentText,
  getDocumentStateVector,
} from "./core/apply-operations";
export type { CRDTDoc } from "./core/apply-operations";
export { createUndoManager, trackOperation, undo, redo, canUndo, canRedo } from "./core/undo-manager";
export type { UndoManager } from "./core/undo-manager";
export { collectGarbage } from "./core/gc";
export { createLWWRegister, setLWWRegister } from "./core/lww-register";
export type { LWWRegister } from "./core/lww-register";
export { createORSet, addToSet, removeFromSet, getSetValues } from "./core/or-set";
export type { ORSet, ORSetEntry } from "./core/or-set";
export { generateKeyBetween } from "./core/fractional-index";

// Document
export {
  createDocument,
  insertBlock,
  deleteBlock,
  insertText,
  deleteText,
  getBlockCount,
  getBlockText,
  getPlainText,
} from "./document/document";
export type { CRDTDocument, Block } from "./document/document";
export {
  encodeSnapshot,
  decodeSnapshot,
  encodeRecordSnapshot,
  decodeRecordSnapshot,
  mergeRecordSnapshots,
  getRecordSnapshotVersion,
  isRecordSnapshotVersion,
  getRecordSnapshotStateVector,
  missingFromRecordSnapshot,
} from "./document/snapshot";
export type { SnapshotMergeBias } from "./document/snapshot";
export {
  createRecord,
  applyRecordOp,
  applyRecordOps,
  getField,
  getFields,
  getSetField,
  getBodyText,
} from "./document/record";
export type { CRDTRecord, FieldOp, SetOp, RecordOp } from "./document/record";
export {
  getColumns,
  getCardsInColumn,
  getCardPosition,
} from "./document/board-document";
export type { CardPosition } from "./document/board-document";
export {
  createDocManager,
  getOrCreateDoc,
  applyDocOperation,
  applySnapshotToDoc,
  getDoc,
  listDocIds,
  deleteDoc,
  BOARD_DOC_ID,
} from "./document/doc-manager";
export type { DocManager, SnapshotHydrationMode } from "./document/doc-manager";
export { recordToMarkdown, markdownToRecordOps } from "./document/yaml-serialization";

// Network
export { createStateVector, updateStateVector, missingOps, filterMissingOps, encodeStateVector, decodeStateVector } from "./network/state-vector";
export type { StateVector, MissingRange } from "./network/state-vector";
export {
  createSyncEngine,
  generateSyncStep1,
  receiveSyncStep1,
  receiveSyncStep2,
  fullSync,
} from "./network/sync";
export type { SyncEngine, SyncMessage, SyncStep1Message, SyncStep2Message } from "./network/sync";
export { encodeOperations, decodeOperations } from "./network/encoding";
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

// Network (transport)
export { createMultiDocTransport } from "./network/multi-doc-transport";
export type { MultiDocTransport } from "./network/multi-doc-transport";

// Server (document API + suggestions)
export {
  editDocument,
  insertAtAnchor,
  suggestEdit,
  suggestInsert,
  acceptSuggestion,
  rejectSuggestion,
  listSuggestions,
} from "./server/document-api";
export type {
  EditResult,
  EditError,
  EditOutcome,
  SuggestResult,
  SuggestOutcome,
  SuggestionSummary,
} from "./server/document-api";

// Server (card API)
export {
  createCard,
  updateCardFields,
  addCardTags,
  removeCardTags,
  moveCard,
  addColumn,
  removeColumn,
  getCardSummary,
  getCardDetail,
  listCards,
  getBoardState,
} from "./server/card-api";
export type { CardApiState, CardApiResult } from "./server/card-api";

// Server (WebSocket handler)
export { createCRDTWebSocketHandler } from "./server/websocket-handler";
export type { CRDTWebSocketHandler, WSClient } from "./server/websocket-handler";

// ProseMirror
export { crdtToProseMirror, proseMirrorPositionToCRDT } from "./prosemirror/state-mapping";
export type { CRDTPosition } from "./prosemirror/state-mapping";
export { transactionToCRDTOps } from "./prosemirror/transaction-capture";
export {
  createCRDTPlugin,
  getCRDTState,
  applyRemoteOps,
  undoCommand,
  redoCommand,
} from "./prosemirror/plugin";
export type { CRDTPluginState } from "./prosemirror/plugin";
export {
  createCursorPlugin,
  updateRemoteCursors,
  awarenessToRemoteCursor,
} from "./prosemirror/cursor-decorations";
export type { RemoteCursor } from "./prosemirror/cursor-decorations";
