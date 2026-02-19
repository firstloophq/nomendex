import type { ClientId } from "./client-id";

// --- Operation ID ---

export interface OperationId {
  readonly clientId: ClientId;
  readonly clock: number;
}

export function createOperationId(params: {
  clientId: ClientId;
  clock: number;
}): OperationId {
  return { clientId: params.clientId, clock: params.clock };
}

export function operationIdEquals(params: {
  a: OperationId;
  b: OperationId;
}): boolean {
  return (
    params.a.clientId === params.b.clientId &&
    params.a.clock === params.b.clock
  );
}

// --- Content ---

export interface TextContent {
  readonly type: "text";
  readonly value: string;
}

export interface BlockContent {
  readonly type: "block";
  readonly blockType: string; // "paragraph", "heading", etc.
  readonly attrs?: Record<string, string | number | boolean | null>;
  readonly parentBlockId?: OperationId; // container block this belongs to (undefined = root)
}

export interface InlineAtomContent {
  readonly type: "inline_atom";
  readonly nodeType: string; // "wiki_link", "hard_break", "image"
  readonly attrs?: Record<string, string | number | boolean | null>;
}

export type Content = TextContent | BlockContent | InlineAtomContent;

// --- Marks ---

export interface Mark {
  readonly type: string; // "bold", "italic", "link", etc.
  readonly attrs?: Record<string, string | number | boolean | null>;
}

// --- Operations ---

export interface InsertOp {
  readonly type: "insert";
  readonly id: OperationId;
  readonly parentId: OperationId | null; // item to insert after/before
  readonly side: "left" | "right";
  // The other boundary anchor for bounding YATA's scanning range.
  // When side="right": parentId → leftOrigin, secondParentId → rightOrigin.
  // When side="left":  parentId → rightOrigin, secondParentId → leftOrigin.
  // Omit when no second anchor is known (e.g., appending at end of text).
  readonly secondParentId?: OperationId;
  readonly content: Content;
  readonly marks?: ReadonlyArray<Mark>;
}

export interface DeleteOp {
  readonly type: "delete";
  readonly id: OperationId;
  readonly targetId: OperationId;
}

export interface FormatOp {
  readonly type: "format";
  readonly id: OperationId;
  readonly targetId: OperationId;
  readonly mark: Mark;
  readonly action: "add" | "remove";
}

export interface AttrUpdateOp {
  readonly type: "attr_update";
  readonly id: OperationId;
  readonly targetId: OperationId;
  readonly attr: string;
  readonly value: string | number | boolean | null;
  readonly oldValue?: string | number | boolean | null; // for undo — not sent over wire
}

export interface ReparentOp {
  readonly type: "reparent";
  readonly id: OperationId;
  readonly targetId: OperationId;
  readonly newParentBlockId: OperationId | null;
  readonly oldParentBlockId?: OperationId | null; // for undo — not sent over wire
}

export type Operation = InsertOp | DeleteOp | FormatOp | AttrUpdateOp | ReparentOp;

// --- Factory functions ---

export function createInsertOp(params: {
  id: OperationId;
  parentId: OperationId | null;
  side: "left" | "right";
  secondParentId?: OperationId;
  content: Content;
  marks?: ReadonlyArray<Mark>;
}): InsertOp {
  const op: InsertOp = {
    type: "insert",
    id: params.id,
    parentId: params.parentId,
    side: params.side,
    content: params.content,
  };
  let result = op;
  if (params.secondParentId !== undefined) {
    result = { ...result, secondParentId: params.secondParentId };
  }
  if (params.marks !== undefined) {
    result = { ...result, marks: params.marks };
  }
  return result;
}

export function createDeleteOp(params: {
  id: OperationId;
  targetId: OperationId;
}): DeleteOp {
  return {
    type: "delete",
    id: params.id,
    targetId: params.targetId,
  };
}

export function createFormatOp(params: {
  id: OperationId;
  targetId: OperationId;
  mark: Mark;
  action: "add" | "remove";
}): FormatOp {
  return {
    type: "format",
    id: params.id,
    targetId: params.targetId,
    mark: params.mark,
    action: params.action,
  };
}

export function createAttrUpdateOp(params: {
  id: OperationId;
  targetId: OperationId;
  attr: string;
  value: string | number | boolean | null;
  oldValue?: string | number | boolean | null;
}): AttrUpdateOp {
  const op: AttrUpdateOp = {
    type: "attr_update",
    id: params.id,
    targetId: params.targetId,
    attr: params.attr,
    value: params.value,
  };
  if (params.oldValue !== undefined) {
    return { ...op, oldValue: params.oldValue };
  }
  return op;
}

export function createReparentOp(params: {
  id: OperationId;
  targetId: OperationId;
  newParentBlockId: OperationId | null;
  oldParentBlockId?: OperationId | null;
}): ReparentOp {
  const op: ReparentOp = {
    type: "reparent",
    id: params.id,
    targetId: params.targetId,
    newParentBlockId: params.newParentBlockId,
  };
  if (params.oldParentBlockId !== undefined) {
    return { ...op, oldParentBlockId: params.oldParentBlockId };
  }
  return op;
}
