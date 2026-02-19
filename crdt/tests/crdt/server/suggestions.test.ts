import { describe, test, expect } from "bun:test";
import { createEmptyDocument, applyOperation, applyOperations, getDocumentText } from "@/crdt/core/apply-operations";
import type { CRDTDoc } from "@/crdt/core/apply-operations";
import { createClock } from "@/crdt/core/lamport-clock";
import type { LamportClock } from "@/crdt/core/lamport-clock";
import { createOperationId, createInsertOp } from "@/crdt/core/operations";
import {
  insertAtAnchor,
  suggestEdit,
  suggestInsert,
  acceptSuggestion,
  rejectSuggestion,
  listSuggestions,
} from "@/crdt/server/document-api";

function createDocWithParagraph(): { doc: CRDTDoc; clock: LamportClock } {
  let doc = createEmptyDocument();
  const clock = createClock({ clientId: "test" });

  const paragraphOp = createInsertOp({
    id: createOperationId({ clientId: "shared-init", clock: 1 }),
    parentId: null,
    side: "right",
    content: { type: "block", blockType: "paragraph" },
  });

  doc = applyOperation({ doc, op: paragraphOp });
  return { doc, clock };
}

function insertText(params: { doc: CRDTDoc; clock: LamportClock; text: string }): { doc: CRDTDoc; clock: LamportClock } {
  let { doc, clock } = params;
  const result = insertAtAnchor({ doc, clock, content: params.text });
  if (!result.success) throw new Error("insertText failed");
  return { doc: result.doc, clock: result.clock };
}

describe("suggestEdit", () => {
  test("marks old text for deletion and inserts new text as suggestion", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Text should still contain both old and new text (nothing actually deleted)
    const text = getDocumentText({ doc: result.doc });
    expect(text).toContain("hello");
    expect(text).toContain("goodbye");
    expect(text).toContain("world");

    // Should have a suggestionId
    expect(result.suggestionId).toBeTruthy();

    // Ops should include format ops (for delete marks) and insert ops (for new text)
    expect(result.ops.length).toBeGreaterThan(0);
    const formatOps = result.ops.filter((op) => op.type === "format");
    const insertOps = result.ops.filter((op) => op.type === "insert");
    expect(formatOps.length).toBe(5); // "hello" = 5 chars
    expect(insertOps.length).toBe(7); // "goodbye" = 7 chars
  });

  test("pure deletion suggestion (empty newString)", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = suggestEdit({ doc, clock, oldString: "hello ", newString: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Text unchanged (deletion only suggested, not applied)
    expect(getDocumentText({ doc: result.doc })).toBe("hello world");

    // Only format ops (no inserts)
    const insertOps = result.ops.filter((op) => op.type === "insert");
    expect(insertOps.length).toBe(0);
  });

  test("items have suggestion marks", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    if (!result.success) return;

    const suggestions = listSuggestions({ doc: result.doc });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.deleteText).toBe("hello");
    expect(suggestions[0]!.insertText).toBe("goodbye");
    expect(suggestions[0]!.id).toBe(result.suggestionId);
  });

  test("fails when oldString is empty", () => {
    const { doc, clock } = createDocWithParagraph();
    const result = suggestEdit({ doc, clock, oldString: "", newString: "x" });
    expect(result.success).toBe(false);
  });

  test("fails when string not found", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const result = suggestEdit({ doc, clock, oldString: "nonexistent", newString: "x" });
    expect(result.success).toBe(false);
  });

  test("fails when multiple matches found", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "abcabc" }));

    const result = suggestEdit({ doc, clock, oldString: "abc", newString: "x" });
    expect(result.success).toBe(false);
  });
});

describe("suggestInsert", () => {
  test("inserts text with suggestion mark at end", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const result = suggestInsert({ doc, clock, content: " world" });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // New text is present (as suggestion)
    expect(getDocumentText({ doc: result.doc })).toBe("hello world");

    // Listed as suggestion
    const suggestions = listSuggestions({ doc: result.doc });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.insertText).toBe(" world");
    expect(suggestions[0]!.deleteText).toBe("");
  });

  test("inserts before anchor with suggestion mark", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = suggestInsert({ doc, clock, content: "beautiful ", anchor: "world", position: "before" });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(getDocumentText({ doc: result.doc })).toBe("hello beautiful world");

    const suggestions = listSuggestions({ doc: result.doc });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.insertText).toBe("beautiful ");
  });

  test("fails when content is empty", () => {
    const { doc, clock } = createDocWithParagraph();
    const result = suggestInsert({ doc, clock, content: "" });
    expect(result.success).toBe(false);
  });
});

describe("acceptSuggestion", () => {
  test("accepting an edit suggestion finalizes the replacement", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const suggestResult = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const acceptResult = acceptSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    expect(acceptResult.success).toBe(true);
    if (!acceptResult.success) return;

    // After accept: "hello" should be deleted, "goodbye" should remain
    expect(getDocumentText({ doc: acceptResult.doc })).toBe("goodbye world");

    // No more pending suggestions
    const suggestions = listSuggestions({ doc: acceptResult.doc });
    expect(suggestions.length).toBe(0);
  });

  test("accepting a pure deletion removes the text", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const suggestResult = suggestEdit({ doc, clock, oldString: "hello ", newString: "" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const acceptResult = acceptSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    expect(acceptResult.success).toBe(true);
    if (!acceptResult.success) return;

    expect(getDocumentText({ doc: acceptResult.doc })).toBe("world");
  });

  test("accepting an insert suggestion keeps the text and removes marks", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const suggestResult = suggestInsert({ doc, clock, content: " world" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const acceptResult = acceptSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    expect(acceptResult.success).toBe(true);
    if (!acceptResult.success) return;

    expect(getDocumentText({ doc: acceptResult.doc })).toBe("hello world");
    expect(listSuggestions({ doc: acceptResult.doc }).length).toBe(0);
  });

  test("fails for nonexistent suggestion ID", () => {
    const { doc, clock } = createDocWithParagraph();
    const result = acceptSuggestion({ doc, clock, suggestionId: "nonexistent" });
    expect(result.success).toBe(false);
  });
});

describe("rejectSuggestion", () => {
  test("rejecting an edit restores original text", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const suggestResult = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const rejectResult = rejectSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    expect(rejectResult.success).toBe(true);
    if (!rejectResult.success) return;

    // After reject: "goodbye" deleted, "hello" still there, no marks
    expect(getDocumentText({ doc: rejectResult.doc })).toBe("hello world");
    expect(listSuggestions({ doc: rejectResult.doc }).length).toBe(0);
  });

  test("rejecting a pure deletion removes marks, text unchanged", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const suggestResult = suggestEdit({ doc, clock, oldString: "hello ", newString: "" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const rejectResult = rejectSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    expect(rejectResult.success).toBe(true);
    if (!rejectResult.success) return;

    expect(getDocumentText({ doc: rejectResult.doc })).toBe("hello world");
    expect(listSuggestions({ doc: rejectResult.doc }).length).toBe(0);
  });

  test("rejecting an insert suggestion removes the suggested text", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const suggestResult = suggestInsert({ doc, clock, content: " world" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const rejectResult = rejectSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    expect(rejectResult.success).toBe(true);
    if (!rejectResult.success) return;

    expect(getDocumentText({ doc: rejectResult.doc })).toBe("hello");
    expect(listSuggestions({ doc: rejectResult.doc }).length).toBe(0);
  });

  test("fails for nonexistent suggestion ID", () => {
    const { doc, clock } = createDocWithParagraph();
    const result = rejectSuggestion({ doc, clock, suggestionId: "nonexistent" });
    expect(result.success).toBe(false);
  });
});

describe("listSuggestions", () => {
  test("returns empty array when no suggestions", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    expect(listSuggestions({ doc }).length).toBe(0);
  });

  test("groups by suggestionId correctly", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    // Create two separate suggestions
    const result1 = suggestEdit({ doc, clock, oldString: "hello", newString: "hi" });
    if (!result1.success) throw new Error("suggest 1 failed");

    const result2 = suggestInsert({
      doc: result1.doc,
      clock: result1.clock,
      content: "!",
    });
    if (!result2.success) throw new Error("suggest 2 failed");

    const suggestions = listSuggestions({ doc: result2.doc });
    expect(suggestions.length).toBe(2);

    // Each suggestion has its own ID
    const ids = suggestions.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("correctly reports insert and delete text per suggestion", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    if (!result.success) throw new Error("suggest failed");

    const suggestions = listSuggestions({ doc: result.doc });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.deleteText).toBe("hello");
    expect(suggestions[0]!.insertText).toBe("goodbye");
  });
});

describe("round-trip convergence", () => {
  test("suggest → accept: all ops applied to a fresh doc converge", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    // Collect all ops
    const baseOps = [...doc.store.items.map((item) => {
      // Reconstruct the insert ops from items (simplified: use store items)
      return createInsertOp({
        id: item.id,
        parentId: item.leftOrigin ?? item.rightOrigin,
        side: item.leftOrigin ? "right" : (item.rightOrigin ? "left" : "right"),
        content: item.content,
        marks: item.marks ? [...item.marks] : undefined,
      });
    })];

    // Now suggest an edit
    const suggestResult = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    if (!suggestResult.success) throw new Error("suggest failed");

    // Accept it
    const acceptResult = acceptSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    if (!acceptResult.success) throw new Error("accept failed");

    // Apply suggest ops + accept ops to a fresh doc with the same base
    let freshDoc = doc;
    freshDoc = applyOperations({ doc: freshDoc, ops: suggestResult.ops });
    freshDoc = applyOperations({ doc: freshDoc, ops: acceptResult.ops });

    // Both docs should have the same text
    expect(getDocumentText({ doc: freshDoc })).toBe(getDocumentText({ doc: acceptResult.doc }));
    expect(getDocumentText({ doc: acceptResult.doc })).toBe("goodbye world");
  });

  test("suggest → reject: all ops applied to a fresh doc converge", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const suggestResult = suggestEdit({ doc, clock, oldString: "hello", newString: "goodbye" });
    if (!suggestResult.success) throw new Error("suggest failed");

    const rejectResult = rejectSuggestion({
      doc: suggestResult.doc,
      clock: suggestResult.clock,
      suggestionId: suggestResult.suggestionId,
    });
    if (!rejectResult.success) throw new Error("reject failed");

    // Apply suggest ops + reject ops to a fresh doc with the same base
    let freshDoc = doc;
    freshDoc = applyOperations({ doc: freshDoc, ops: suggestResult.ops });
    freshDoc = applyOperations({ doc: freshDoc, ops: rejectResult.ops });

    expect(getDocumentText({ doc: freshDoc })).toBe(getDocumentText({ doc: rejectResult.doc }));
    expect(getDocumentText({ doc: rejectResult.doc })).toBe("hello world");
  });

  test("multiple suggestions can coexist and be resolved independently", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello beautiful world" }));

    // Suggestion 1: hello → hi
    const s1 = suggestEdit({ doc, clock, oldString: "hello", newString: "hi" });
    if (!s1.success) throw new Error("s1 failed");

    // Suggestion 2: world → earth
    const s2 = suggestEdit({ doc: s1.doc, clock: s1.clock, oldString: "world", newString: "earth" });
    if (!s2.success) throw new Error("s2 failed");

    expect(listSuggestions({ doc: s2.doc }).length).toBe(2);

    // Accept s1, reject s2
    const a1 = acceptSuggestion({ doc: s2.doc, clock: s2.clock, suggestionId: s1.suggestionId });
    if (!a1.success) throw new Error("accept s1 failed");

    const r2 = rejectSuggestion({ doc: a1.doc, clock: a1.clock, suggestionId: s2.suggestionId });
    if (!r2.success) throw new Error("reject s2 failed");

    expect(getDocumentText({ doc: r2.doc })).toBe("hi beautiful world");
    expect(listSuggestions({ doc: r2.doc }).length).toBe(0);
  });
});
