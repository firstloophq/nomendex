// Server sub-entry point: @crdt/lib/server

// WebSocket handler
export { createCRDTWebSocketHandler } from "./websocket-handler";
export type { CRDTWebSocketHandler, WSClient } from "./websocket-handler";

// Document API (content-addressed editing + suggestions)
export {
  editDocument,
  insertAtAnchor,
  suggestEdit,
  suggestInsert,
  acceptSuggestion,
  rejectSuggestion,
  listSuggestions,
} from "./document-api";
export type {
  EditResult,
  EditError,
  EditOutcome,
  SuggestResult,
  SuggestOutcome,
  SuggestionSummary,
} from "./document-api";

// Card API (kanban CRUD helpers)
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
} from "./card-api";
export type { CardApiState, CardApiResult } from "./card-api";

// Relay (sidecar pattern — bridges local handler with remote server)
export { createCRDTRelay } from "./relay";
export type { CRDTRelay } from "./relay";

// File-backed doc-op fixtures (simple persistence example)
export {
  parseDocOpsFixture,
  loadDocOpsFixtureFromFile,
  saveDocOpsFixtureToFile,
} from "./doc-ops-fixture";
export type { DocOpsFixtureV1 } from "./doc-ops-fixture";
