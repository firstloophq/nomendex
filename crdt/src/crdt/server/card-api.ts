import type { DocManager } from "../document/doc-manager";
import type { LamportClock, Timestamp } from "../core/lamport-clock";
import type { RecordOp, FieldOp, SetOp } from "../document/record";
import type { OperationId } from "../core/operations";
import { increment } from "../core/lamport-clock";
import { createOperationId } from "../core/operations";
import {
  applyDocOperation,
  getDoc,
  listDocIds,
  deleteDoc,
  BOARD_DOC_ID,
} from "../document/doc-manager";
import {
  getField,
  getFields,
  getSetField,
  getBodyText,
} from "../document/record";
import {
  getColumns,
  getCardsInColumn,
  getCardPosition,
} from "../document/board-document";
import { generateKeyBetween } from "../core/fractional-index";

// --- Helpers ---

function nextId(clock: LamportClock): { clock: LamportClock; id: OperationId; timestamp: Timestamp } {
  const { clock: newClock, timestamp } = increment({ clock });
  return {
    clock: newClock,
    id: createOperationId({ clientId: clock.clientId, clock: timestamp.clock }),
    timestamp,
  };
}

// --- Card Operations ---

export interface CardApiState {
  manager: DocManager;
  clock: LamportClock;
}

export interface CardApiResult {
  state: CardApiState;
  ops?: ReadonlyArray<{ docId: string; op: RecordOp }>;
}

function getBoardRecord(params: { manager: DocManager; boardDocId?: string }) {
  return getDoc({ manager: params.manager, docId: params.boardDocId ?? BOARD_DOC_ID });
}

export function createCard(params: {
  state: CardApiState;
  cardId: string;
  fields?: Record<string, string>;
  tags?: ReadonlyArray<string>;
  column?: string;
  boardDocId?: string;
}): CardApiResult {
  let { manager, clock } = params.state;
  const ops: { docId: string; op: RecordOp }[] = [];

  // Apply field ops
  if (params.fields) {
    for (const [fieldName, value] of Object.entries(params.fields)) {
      const { clock: c, id, timestamp } = nextId(clock);
      clock = c;
      const op: FieldOp = {
        type: "field",
        id,
        fieldName,
        value,
        timestamp,
      };
      manager = applyDocOperation({ manager, docId: params.cardId, op });
      ops.push({ docId: params.cardId, op });
    }
  }

  // Apply tag ops
  if (params.tags) {
    for (const tag of params.tags) {
      const { clock: c, id } = nextId(clock);
      clock = c;
      const op: SetOp = {
        type: "set",
        id,
        fieldName: "tags",
        action: "add",
        value: tag,
      };
      manager = applyDocOperation({ manager, docId: params.cardId, op });
      ops.push({ docId: params.cardId, op });
    }
  }

  // Place card in column if specified
  if (params.column) {
    const bid = params.boardDocId ?? BOARD_DOC_ID;
    const boardRecord = getBoardRecord({ manager, boardDocId: bid });
    const cardsInCol = boardRecord
      ? getCardsInColumn({ record: boardRecord, column: params.column })
      : [];
    const lastOrder = cardsInCol.length > 0 ? cardsInCol[cardsInCol.length - 1]!.order : null;
    const order = generateKeyBetween({ a: lastOrder, b: null });

    const { clock: c, id, timestamp } = nextId(clock);
    clock = c;
    const moveOp: FieldOp = {
      type: "field",
      id,
      fieldName: `card:${params.cardId}`,
      value: JSON.stringify({ column: params.column, order }),
      timestamp,
    };
    manager = applyDocOperation({ manager, docId: bid, op: moveOp });
    ops.push({ docId: bid, op: moveOp });
  }

  return { state: { manager, clock }, ops };
}

export function updateCardFields(params: {
  state: CardApiState;
  cardId: string;
  fields: Record<string, string>;
}): CardApiResult {
  let { manager, clock } = params.state;
  const ops: { docId: string; op: RecordOp }[] = [];

  for (const [fieldName, value] of Object.entries(params.fields)) {
    const { clock: c, id, timestamp } = nextId(clock);
    clock = c;
    const op: FieldOp = {
      type: "field",
      id,
      fieldName,
      value,
      timestamp,
    };
    manager = applyDocOperation({ manager, docId: params.cardId, op });
    ops.push({ docId: params.cardId, op });
  }

  return { state: { manager, clock }, ops };
}

export function addCardTags(params: {
  state: CardApiState;
  cardId: string;
  tags: ReadonlyArray<string>;
}): CardApiResult {
  let { manager, clock } = params.state;
  const ops: { docId: string; op: RecordOp }[] = [];

  for (const tag of params.tags) {
    const { clock: c, id } = nextId(clock);
    clock = c;
    const op: SetOp = {
      type: "set",
      id,
      fieldName: "tags",
      action: "add",
      value: tag,
    };
    manager = applyDocOperation({ manager, docId: params.cardId, op });
    ops.push({ docId: params.cardId, op });
  }

  return { state: { manager, clock }, ops };
}

export function removeCardTags(params: {
  state: CardApiState;
  cardId: string;
  tags: ReadonlyArray<string>;
}): CardApiResult {
  let { manager, clock } = params.state;
  const ops: { docId: string; op: RecordOp }[] = [];

  const doc = getDoc({ manager, docId: params.cardId });
  if (!doc) {
    return { state: { manager, clock }, ops: [] };
  }

  for (const tag of params.tags) {
    const orSet = doc.sets.get("tags");
    if (!orSet) continue;

    // Find all active add IDs for this tag value
    const entries = orSet.entries.get(tag);
    if (!entries) continue;
    const activeIds = entries.filter((e) => !e.removed).map((e) => e.id);
    if (activeIds.length === 0) continue;

    const { clock: c, id } = nextId(clock);
    clock = c;
    const op: SetOp = {
      type: "set",
      id,
      fieldName: "tags",
      action: "remove",
      value: tag,
      removeIds: activeIds,
    };
    manager = applyDocOperation({ manager, docId: params.cardId, op });
    ops.push({ docId: params.cardId, op });
  }

  return { state: { manager, clock }, ops };
}

export function moveCard(params: {
  state: CardApiState;
  cardId: string;
  column: string;
  afterCardId?: string;
  beforeCardId?: string;
  boardDocId?: string;
}): CardApiResult {
  let { manager, clock } = params.state;
  const ops: { docId: string; op: RecordOp }[] = [];
  const bid = params.boardDocId ?? BOARD_DOC_ID;

  const boardRecord = getBoardRecord({ manager, boardDocId: bid });
  const cardsInCol = boardRecord
    ? getCardsInColumn({ record: boardRecord, column: params.column })
    : [];

  let beforeOrder: string | null = null;
  let afterOrder: string | null = null;

  if (params.afterCardId) {
    const afterCard = cardsInCol.find((c) => c.cardId === params.afterCardId);
    if (afterCard) afterOrder = afterCard.order;
  }

  if (params.beforeCardId) {
    const beforeCard = cardsInCol.find((c) => c.cardId === params.beforeCardId);
    if (beforeCard) beforeOrder = beforeCard.order;
  }

  // If neither specified, append to end
  if (!params.afterCardId && !params.beforeCardId) {
    afterOrder = cardsInCol.length > 0 ? cardsInCol[cardsInCol.length - 1]!.order : null;
  }

  const order = generateKeyBetween({ a: afterOrder, b: beforeOrder });

  const { clock: c, id, timestamp } = nextId(clock);
  clock = c;
  const moveOp: FieldOp = {
    type: "field",
    id,
    fieldName: `card:${params.cardId}`,
    value: JSON.stringify({ column: params.column, order }),
    timestamp,
  };
  manager = applyDocOperation({ manager, docId: bid, op: moveOp });
  ops.push({ docId: bid, op: moveOp });

  return { state: { manager, clock }, ops };
}

export function addColumn(params: {
  state: CardApiState;
  column: string;
  boardDocId?: string;
}): CardApiResult {
  let { manager, clock } = params.state;
  const bid = params.boardDocId ?? BOARD_DOC_ID;
  const { clock: c, id } = nextId(clock);
  clock = c;

  const op: SetOp = {
    type: "set",
    id,
    fieldName: "columns",
    action: "add",
    value: params.column,
  };
  manager = applyDocOperation({ manager, docId: bid, op });

  return { state: { manager, clock }, ops: [{ docId: bid, op }] };
}

export function removeColumn(params: {
  state: CardApiState;
  column: string;
  boardDocId?: string;
}): CardApiResult {
  let { manager, clock } = params.state;
  const bid = params.boardDocId ?? BOARD_DOC_ID;

  const boardRecord = getBoardRecord({ manager, boardDocId: bid });
  if (!boardRecord) {
    return { state: { manager, clock }, ops: [] };
  }

  // Find all active add IDs for this column in the OR-Set
  const columnsSet = boardRecord.sets.get("columns");
  if (!columnsSet) {
    return { state: { manager, clock }, ops: [] };
  }
  const entries = columnsSet.entries.get(params.column);
  if (!entries) {
    return { state: { manager, clock }, ops: [] };
  }
  const activeIds = entries.filter((e) => !e.removed).map((e) => e.id);
  if (activeIds.length === 0) {
    return { state: { manager, clock }, ops: [] };
  }

  const { clock: c, id } = nextId(clock);
  clock = c;
  const op: SetOp = {
    type: "set",
    id,
    fieldName: "columns",
    action: "remove",
    value: params.column,
    removeIds: activeIds,
  };
  manager = applyDocOperation({ manager, docId: bid, op });

  return { state: { manager, clock }, ops: [{ docId: bid, op }] };
}

// --- Read helpers for API responses ---

export function getCardSummary(params: {
  manager: DocManager;
  cardId: string;
  boardDocId?: string;
}): { id: string; title: string; column: string | null } | null {
  const doc = getDoc({ manager: params.manager, docId: params.cardId });
  if (!doc) return null;

  const boardRecord = getBoardRecord({ manager: params.manager, boardDocId: params.boardDocId });
  const pos = boardRecord ? getCardPosition({ record: boardRecord, cardId: params.cardId }) : undefined;
  return {
    id: params.cardId,
    title: getField({ record: doc, fieldName: "title" }) ?? "",
    column: pos?.column ?? null,
  };
}

export function getCardDetail(params: {
  manager: DocManager;
  cardId: string;
  boardDocId?: string;
}): {
  id: string;
  fields: Record<string, string>;
  tags: ReadonlyArray<string>;
  body: string;
  position: { column: string; order: string } | null;
} | null {
  const doc = getDoc({ manager: params.manager, docId: params.cardId });
  if (!doc) return null;

  const fields: Record<string, string> = {};
  for (const [name, value] of getFields({ record: doc })) {
    fields[name] = value;
  }

  const boardRecord = getBoardRecord({ manager: params.manager, boardDocId: params.boardDocId });
  const pos = boardRecord ? getCardPosition({ record: boardRecord, cardId: params.cardId }) : undefined;

  return {
    id: params.cardId,
    fields,
    tags: [...getSetField({ record: doc, fieldName: "tags" })],
    body: getBodyText({ record: doc }),
    position: pos ?? null,
  };
}

export function listCards(params: {
  manager: DocManager;
  boardDocId?: string;
}): ReadonlyArray<{ id: string; title: string; column: string | null }> {
  const bid = params.boardDocId ?? BOARD_DOC_ID;
  const ids = listDocIds({ manager: params.manager });
  const results: { id: string; title: string; column: string | null }[] = [];

  for (const id of ids) {
    // Skip the board record itself
    if (id === bid) continue;
    const summary = getCardSummary({ manager: params.manager, cardId: id, boardDocId: bid });
    if (summary) results.push(summary);
  }

  return results;
}

export function getBoardState(params: {
  manager: DocManager;
  boardDocId?: string;
}): {
  columns: ReadonlyArray<string>;
  cardsByColumn: Record<string, ReadonlyArray<{ cardId: string; title: string; description: string; order: string }>>;
} {
  const boardRecord = getBoardRecord({ manager: params.manager, boardDocId: params.boardDocId });
  const columns = boardRecord ? getColumns({ record: boardRecord }) : [];
  const cardsByColumn: Record<string, { cardId: string; title: string; description: string; order: string }[]> = {};

  for (const col of columns) {
    const cards = boardRecord ? getCardsInColumn({ record: boardRecord, column: col }) : [];
    cardsByColumn[col] = cards.map((c) => {
      const doc = getDoc({ manager: params.manager, docId: c.cardId });
      const title = doc ? (getField({ record: doc, fieldName: "title" }) ?? "") : "";
      const description = doc ? (getField({ record: doc, fieldName: "description" }) ?? "") : "";
      return { cardId: c.cardId, title, description, order: c.order };
    });
  }

  return { columns: [...columns], cardsByColumn };
}
