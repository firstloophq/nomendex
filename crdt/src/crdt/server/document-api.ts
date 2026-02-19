import type { CRDTDoc } from "../core/apply-operations";
import { applyOperation, getDocumentText } from "../core/apply-operations";
import type { LamportClock } from "../core/lamport-clock";
import { increment } from "../core/lamport-clock";
import {
  createOperationId,
  createInsertOp,
  createDeleteOp,
  createFormatOp,
} from "../core/operations";
import type { Operation, OperationId, Mark } from "../core/operations";
import type { Item } from "../core/item";

// --- Types ---

export interface EditResult {
  readonly success: true;
  readonly doc: CRDTDoc;
  readonly clock: LamportClock;
  readonly ops: ReadonlyArray<Operation>;
}

export interface EditError {
  readonly success: false;
  readonly error: string;
}

export type EditOutcome = EditResult | EditError;

// --- Helpers ---

/** Get the ordered list of visible text items from the doc */
function getVisibleTextItems(params: { doc: CRDTDoc }): ReadonlyArray<Item> {
  return params.doc.store.items.filter(
    (item) => !item.deleted && item.content.type === "text"
  );
}

/**
 * Validate that searchString appears exactly once in the visible text.
 * Returns the index or an error string.
 */
function validateUniqueMatch(params: {
  text: string;
  searchString: string;
}): { idx: number } | { error: string } {
  const idx = params.text.indexOf(params.searchString);
  if (idx === -1) return { error: "string not found" };
  const secondIdx = params.text.indexOf(params.searchString, idx + 1);
  if (secondIdx !== -1) return { error: "multiple matches found — provide more context" };
  return { idx };
}

/**
 * Find the visible text items covering character range [charStart, charEnd).
 * Returns matched items and their index range in the visible text items array.
 */
function findItemsInCharRange(params: {
  doc: CRDTDoc;
  charStart: number;
  charEnd: number;
}): { items: ReadonlyArray<Item>; startIdx: number; endIdx: number } {
  const visibleItems = getVisibleTextItems({ doc: params.doc });
  const matched: Array<Item> = [];
  let startIdx = -1;
  let endIdx = -1;
  let charOffset = 0;

  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i]!;
    const val = item.content.type === "text" ? item.content.value : "";
    const itemEnd = charOffset + val.length;

    if (itemEnd > params.charStart && charOffset < params.charEnd) {
      if (startIdx === -1) startIdx = i;
      endIdx = i;
      matched.push(item);
    }

    charOffset = itemEnd;
    if (charOffset >= params.charEnd) break;
  }

  return { items: matched, startIdx, endIdx };
}

/**
 * Build insert ops for a string of characters.
 *
 * When `rightAnchor` is provided, ALL characters use side="left" with
 * rightAnchor as parentId. YATA orders them correctly because each
 * successive char has a higher clock, so earlier chars sort first.
 *
 * When only `leftAnchor` is available (append case), use side="right"
 * chaining each char to the previous one.
 */
function buildInsertOps(params: {
  text: string;
  clock: LamportClock;
  leftAnchor: OperationId | null;
  rightAnchor: OperationId | null;
  marks?: ReadonlyArray<Mark>;
}): { ops: Array<Operation>; clock: LamportClock } {
  const { text, leftAnchor, rightAnchor, marks } = params;
  let { clock } = params;
  const ops: Array<Operation> = [];
  let prevId: OperationId | null = null;

  for (let i = 0; i < text.length; i++) {
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;
    const opId = createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock });

    let insertOp: Operation;
    if (rightAnchor !== null) {
      // Use side="left" with rightAnchor for all chars.
      // YATA places them before rightAnchor, ordered by ascending clock.
      // Pass leftAnchor as secondParentId to bound the scanning range.
      insertOp = createInsertOp({
        id: opId,
        parentId: rightAnchor,
        side: "left",
        secondParentId: leftAnchor ?? undefined,
        content: { type: "text", value: text[i]! },
        marks,
      });
    } else {
      // Append case: chain each char to the previous via side="right"
      insertOp = createInsertOp({
        id: opId,
        parentId: i === 0 ? leftAnchor : prevId,
        side: "right",
        content: { type: "text", value: text[i]! },
        marks,
      });
    }

    ops.push(insertOp);
    prevId = opId;
  }

  return { ops, clock };
}

// --- API functions ---

/** Content-addressed edit: find oldString, replace with newString */
export function editDocument(params: {
  doc: CRDTDoc;
  clock: LamportClock;
  oldString: string;
  newString: string;
}): EditOutcome {
  const { doc, oldString, newString } = params;
  let { clock } = params;

  if (oldString === "") {
    return { success: false, error: "oldString must not be empty" };
  }

  const text = getDocumentText({ doc });
  const matchValidation = validateUniqueMatch({ text, searchString: oldString });
  if ("error" in matchValidation) {
    return { success: false, error: matchValidation.error };
  }

  const { idx } = matchValidation;
  const matchEnd = idx + oldString.length;
  const { items: matchedItems, endIdx } = findItemsInCharRange({
    doc,
    charStart: idx,
    charEnd: matchEnd,
  });

  if (matchedItems.length === 0) {
    return { success: false, error: "string not found" };
  }

  const allOps: Array<Operation> = [];
  let currentDoc = doc;

  // Delete matched items
  for (const item of matchedItems) {
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;
    const deleteOp = createDeleteOp({
      id: createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock }),
      targetId: item.id,
    });
    allOps.push(deleteOp);
    currentDoc = applyOperation({ doc: currentDoc, op: deleteOp });
  }

  // Insert new text
  if (newString.length > 0) {
    const visibleItems = getVisibleTextItems({ doc });

    // rightAnchor: first visible text item after the match
    const rightAnchor = endIdx + 1 < visibleItems.length
      ? visibleItems[endIdx + 1]!.id
      : null;

    // leftAnchor: last matched item (boundary for the insertion point)
    // When no rightAnchor (append), use last visible item overall
    let leftAnchor: OperationId | null = matchedItems[matchedItems.length - 1]!.id;
    if (rightAnchor === null) {
      const allVisible = doc.store.items.filter((item) => !item.deleted);
      if (allVisible.length > 0) {
        leftAnchor = allVisible[allVisible.length - 1]!.id;
      }
    }

    const insertResult = buildInsertOps({ text: newString, clock, leftAnchor, rightAnchor });
    clock = insertResult.clock;

    for (const op of insertResult.ops) {
      allOps.push(op);
      currentDoc = applyOperation({ doc: currentDoc, op });
    }
  }

  return { success: true, doc: currentDoc, clock, ops: allOps };
}

/** Anchor-based insert: insert content relative to an anchor string */
export function insertAtAnchor(params: {
  doc: CRDTDoc;
  clock: LamportClock;
  content: string;
  anchor?: string;
  position?: "before" | "after";
}): EditOutcome {
  const { doc, content, anchor, position = "after" } = params;
  let { clock } = params;

  if (content === "") {
    return { success: false, error: "content must not be empty" };
  }

  let leftAnchor: OperationId | null = null;
  let rightAnchor: OperationId | null = null;

  if (!anchor || anchor === "") {
    // Append to end — side "right" with last visible item
    const allVisible = doc.store.items.filter((item) => !item.deleted);
    if (allVisible.length > 0) {
      leftAnchor = allVisible[allVisible.length - 1]!.id;
    }
  } else {
    const text = getDocumentText({ doc });
    const matchValidation = validateUniqueMatch({ text, searchString: anchor });
    if ("error" in matchValidation) {
      return { success: false, error: matchValidation.error.replace("string", "anchor string") };
    }

    const { idx } = matchValidation;
    const matchEnd = idx + anchor.length;
    const visibleItems = getVisibleTextItems({ doc });
    const { items: matchedItems, startIdx, endIdx } = findItemsInCharRange({
      doc,
      charStart: idx,
      charEnd: matchEnd,
    });

    if (position === "before") {
      // Insert before anchor: rightAnchor = first item of match
      if (matchedItems.length > 0) {
        rightAnchor = matchedItems[0]!.id;
      }
      // leftAnchor = item before the match
      if (startIdx > 0) {
        leftAnchor = visibleItems[startIdx - 1]!.id;
      }
    } else {
      // Insert after anchor: rightAnchor = first item after match end
      if (endIdx + 1 < visibleItems.length) {
        rightAnchor = visibleItems[endIdx + 1]!.id;
        // leftAnchor = last item of match
        if (matchedItems.length > 0) {
          leftAnchor = matchedItems[matchedItems.length - 1]!.id;
        }
      } else {
        // Anchor is at end of text — append after last match item
        if (matchedItems.length > 0) {
          leftAnchor = matchedItems[matchedItems.length - 1]!.id;
        }
      }
    }
  }

  const insertResult = buildInsertOps({ text: content, clock, leftAnchor, rightAnchor });
  clock = insertResult.clock;

  let currentDoc = doc;
  const allOps: Array<Operation> = [];
  for (const op of insertResult.ops) {
    allOps.push(op);
    currentDoc = applyOperation({ doc: currentDoc, op });
  }

  return { success: true, doc: currentDoc, clock, ops: allOps };
}

// --- Suggestion types ---

export interface SuggestResult {
  readonly success: true;
  readonly doc: CRDTDoc;
  readonly clock: LamportClock;
  readonly ops: ReadonlyArray<Operation>;
  readonly suggestionId: string;
}

export type SuggestOutcome = SuggestResult | EditError;

export interface SuggestionSummary {
  readonly id: string;
  readonly insertText: string;
  readonly deleteText: string;
}

// --- Suggestion API functions ---

/** Suggest a content-addressed edit: marks old text for deletion, inserts new text as suggestion */
export function suggestEdit(params: {
  doc: CRDTDoc;
  clock: LamportClock;
  oldString: string;
  newString: string;
}): SuggestOutcome {
  const { doc, oldString, newString } = params;
  let { clock } = params;

  if (oldString === "") {
    return { success: false, error: "oldString must not be empty" };
  }

  const text = getDocumentText({ doc });
  const matchValidation = validateUniqueMatch({ text, searchString: oldString });
  if ("error" in matchValidation) {
    return { success: false, error: matchValidation.error };
  }

  const { idx } = matchValidation;
  const matchEnd = idx + oldString.length;
  const visibleTextItems = getVisibleTextItems({ doc });
  const { items: matchedItems, endIdx } = findItemsInCharRange({
    doc,
    charStart: idx,
    charEnd: matchEnd,
  });

  if (matchedItems.length === 0) {
    return { success: false, error: "string not found" };
  }

  const suggestionId = crypto.randomUUID();
  const allOps: Array<Operation> = [];
  let currentDoc = doc;

  // Mark matched items with suggestion:delete
  const deleteMark: Mark = {
    type: "suggestion",
    attrs: { id: suggestionId, action: "delete" },
  };

  for (const item of matchedItems) {
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;
    const formatOp = createFormatOp({
      id: createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock }),
      targetId: item.id,
      mark: deleteMark,
      action: "add",
    });
    allOps.push(formatOp);
    currentDoc = applyOperation({ doc: currentDoc, op: formatOp });
  }

  // Insert new text with suggestion:insert mark
  if (newString.length > 0) {
    const insertMark: Mark = {
      type: "suggestion",
      attrs: { id: suggestionId, action: "insert" },
    };

    // Position: after the matched items, before the next visible text item
    const rightAnchor = endIdx + 1 < visibleTextItems.length
      ? visibleTextItems[endIdx + 1]!.id
      : null;

    // leftAnchor: last matched item (insertion boundary)
    const leftAnchor: OperationId | null = matchedItems[matchedItems.length - 1]!.id;

    const insertResult = buildInsertOps({
      text: newString,
      clock,
      leftAnchor,
      rightAnchor,
      marks: [insertMark],
    });
    clock = insertResult.clock;

    for (const op of insertResult.ops) {
      allOps.push(op);
      currentDoc = applyOperation({ doc: currentDoc, op });
    }
  }

  return { success: true, doc: currentDoc, clock, ops: allOps, suggestionId };
}

/** Suggest an anchor-based insert: inserts content with suggestion mark */
export function suggestInsert(params: {
  doc: CRDTDoc;
  clock: LamportClock;
  content: string;
  anchor?: string;
  position?: "before" | "after";
}): SuggestOutcome {
  const { doc, content, anchor, position = "after" } = params;
  let { clock } = params;

  if (content === "") {
    return { success: false, error: "content must not be empty" };
  }

  const suggestionId = crypto.randomUUID();
  const insertMark: Mark = {
    type: "suggestion",
    attrs: { id: suggestionId, action: "insert" },
  };

  let leftAnchor: OperationId | null = null;
  let rightAnchor: OperationId | null = null;

  if (!anchor || anchor === "") {
    const allVisible = doc.store.items.filter((item) => !item.deleted);
    if (allVisible.length > 0) {
      leftAnchor = allVisible[allVisible.length - 1]!.id;
    }
  } else {
    const text = getDocumentText({ doc });
    const matchValidation = validateUniqueMatch({ text, searchString: anchor });
    if ("error" in matchValidation) {
      return { success: false, error: matchValidation.error.replace("string", "anchor string") };
    }

    const { idx } = matchValidation;
    const matchEnd = idx + anchor.length;
    const visibleItems = getVisibleTextItems({ doc });
    const { items: matchedItems, startIdx, endIdx } = findItemsInCharRange({
      doc,
      charStart: idx,
      charEnd: matchEnd,
    });

    if (position === "before") {
      if (matchedItems.length > 0) {
        rightAnchor = matchedItems[0]!.id;
      }
      if (startIdx > 0) {
        leftAnchor = visibleItems[startIdx - 1]!.id;
      }
    } else {
      if (endIdx + 1 < visibleItems.length) {
        rightAnchor = visibleItems[endIdx + 1]!.id;
        if (matchedItems.length > 0) {
          leftAnchor = matchedItems[matchedItems.length - 1]!.id;
        }
      } else {
        if (matchedItems.length > 0) {
          leftAnchor = matchedItems[matchedItems.length - 1]!.id;
        }
      }
    }
  }

  const insertResult = buildInsertOps({
    text: content,
    clock,
    leftAnchor,
    rightAnchor,
    marks: [insertMark],
  });
  clock = insertResult.clock;

  let currentDoc = doc;
  const allOps: Array<Operation> = [];
  for (const op of insertResult.ops) {
    allOps.push(op);
    currentDoc = applyOperation({ doc: currentDoc, op });
  }

  return { success: true, doc: currentDoc, clock, ops: allOps, suggestionId };
}

/** Accept a suggestion: finalize inserts (remove marks) and apply deletes */
export function acceptSuggestion(params: {
  doc: CRDTDoc;
  clock: LamportClock;
  suggestionId: string;
}): EditOutcome {
  const { suggestionId } = params;
  let { doc, clock } = params;

  const allOps: Array<Operation> = [];
  const removeMark: Mark = { type: "suggestion" };

  for (const item of doc.store.items) {
    if (item.deleted || !item.marks) continue;

    const mark = item.marks.find(
      (m) => m.type === "suggestion" && m.attrs?.id === suggestionId
    );
    if (!mark) continue;

    const action = String(mark.attrs?.action ?? "");

    if (action === "insert") {
      // Accept insert: remove suggestion mark, text stays
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const formatOp = createFormatOp({
        id: createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock }),
        targetId: item.id,
        mark: removeMark,
        action: "remove",
      });
      allOps.push(formatOp);
      doc = applyOperation({ doc, op: formatOp });
    } else if (action === "delete") {
      // Accept delete: actually delete the item
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const deleteOp = createDeleteOp({
        id: createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock }),
        targetId: item.id,
      });
      allOps.push(deleteOp);
      doc = applyOperation({ doc, op: deleteOp });
    }
  }

  if (allOps.length === 0) {
    return { success: false, error: "suggestion not found" };
  }

  return { success: true, doc, clock, ops: allOps };
}

/** Reject a suggestion: delete inserts, remove marks from delete-candidates */
export function rejectSuggestion(params: {
  doc: CRDTDoc;
  clock: LamportClock;
  suggestionId: string;
}): EditOutcome {
  const { suggestionId } = params;
  let { doc, clock } = params;

  const allOps: Array<Operation> = [];
  const removeMark: Mark = { type: "suggestion" };

  for (const item of doc.store.items) {
    if (item.deleted || !item.marks) continue;

    const mark = item.marks.find(
      (m) => m.type === "suggestion" && m.attrs?.id === suggestionId
    );
    if (!mark) continue;

    const action = String(mark.attrs?.action ?? "");

    if (action === "insert") {
      // Reject insert: delete the inserted text
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const deleteOp = createDeleteOp({
        id: createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock }),
        targetId: item.id,
      });
      allOps.push(deleteOp);
      doc = applyOperation({ doc, op: deleteOp });
    } else if (action === "delete") {
      // Reject delete: remove suggestion mark, text stays unchanged
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const formatOp = createFormatOp({
        id: createOperationId({ clientId: timestamp.clientId, clock: timestamp.clock }),
        targetId: item.id,
        mark: removeMark,
        action: "remove",
      });
      allOps.push(formatOp);
      doc = applyOperation({ doc, op: formatOp });
    }
  }

  if (allOps.length === 0) {
    return { success: false, error: "suggestion not found" };
  }

  return { success: true, doc, clock, ops: allOps };
}

/** List all pending suggestions in the document */
export function listSuggestions(params: {
  doc: CRDTDoc;
}): ReadonlyArray<SuggestionSummary> {
  const groups = new Map<string, { insertText: string; deleteText: string }>();

  for (const item of params.doc.store.items) {
    if (item.deleted || !item.marks) continue;

    const mark = item.marks.find((m) => m.type === "suggestion");
    if (!mark || !mark.attrs) continue;

    const id = String(mark.attrs.id);
    const action = String(mark.attrs.action);

    if (!groups.has(id)) {
      groups.set(id, { insertText: "", deleteText: "" });
    }

    const group = groups.get(id)!;
    const textValue = item.content.type === "text" ? item.content.value : "";

    if (action === "insert") {
      group.insertText += textValue;
    } else if (action === "delete") {
      group.deleteText += textValue;
    }
  }

  return Array.from(groups.entries()).map(([id, { insertText, deleteText }]) => ({
    id,
    insertText,
    deleteText,
  }));
}
