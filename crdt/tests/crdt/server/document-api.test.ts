import { describe, test, expect } from "bun:test";
import { createEmptyDocument, applyOperation, getDocumentText } from "@/crdt/core/apply-operations";
import type { CRDTDoc } from "@/crdt/core/apply-operations";
import { createClock, increment } from "@/crdt/core/lamport-clock";
import type { LamportClock } from "@/crdt/core/lamport-clock";
import { createOperationId, createInsertOp } from "@/crdt/core/operations";
import { editDocument, insertAtAnchor } from "@/crdt/server/document-api";

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

describe("editDocument", () => {
  test("replaces a substring", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));
    expect(getDocumentText({ doc })).toBe("hello world");

    const result = editDocument({ doc, clock, oldString: "hello", newString: "goodbye" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("goodbye world");
      expect(result.ops.length).toBeGreaterThan(0);
    }
  });

  test("deletes text when newString is empty", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = editDocument({ doc, clock, oldString: "hello ", newString: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("world");
    }
  });

  test("fails when string not found", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = editDocument({ doc, clock, oldString: "nonexistent", newString: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("string not found");
    }
  });

  test("fails when multiple matches found", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "abcabc" }));

    const result = editDocument({ doc, clock, oldString: "abc", newString: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("multiple matches");
    }
  });

  test("fails when oldString is empty", () => {
    const { doc, clock } = createDocWithParagraph();

    const result = editDocument({ doc, clock, oldString: "", newString: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("empty");
    }
  });

  test("replaces at beginning of document", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = editDocument({ doc, clock, oldString: "hello", newString: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hi world");
    }
  });

  test("replaces at end of document", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = editDocument({ doc, clock, oldString: "world", newString: "earth" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hello earth");
    }
  });

  test("replaces entire document", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const result = editDocument({ doc, clock, oldString: "hello", newString: "goodbye" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("goodbye");
    }
  });
});

describe("insertAtAnchor", () => {
  test("appends to end when no anchor", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const result = insertAtAnchor({ doc, clock, content: " world" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hello world");
    }
  });

  test("inserts after anchor", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = insertAtAnchor({ doc, clock, content: " beautiful", anchor: "hello", position: "after" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hello beautiful world");
    }
  });

  test("inserts before anchor", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello world" }));

    const result = insertAtAnchor({ doc, clock, content: "beautiful ", anchor: "world", position: "before" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hello beautiful world");
    }
  });

  test("inserts before the first character", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "world" }));

    const result = insertAtAnchor({ doc, clock, content: "hello ", anchor: "world", position: "before" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hello world");
    }
  });

  test("fails when anchor not found", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "hello" }));

    const result = insertAtAnchor({ doc, clock, content: "x", anchor: "nonexistent" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
    }
  });

  test("fails when multiple anchor matches", () => {
    let { doc, clock } = createDocWithParagraph();
    ({ doc, clock } = insertText({ doc, clock, text: "abcabc" }));

    const result = insertAtAnchor({ doc, clock, content: "x", anchor: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("multiple");
    }
  });

  test("fails when content is empty", () => {
    const { doc, clock } = createDocWithParagraph();

    const result = insertAtAnchor({ doc, clock, content: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("empty");
    }
  });

  test("inserts into empty document (append)", () => {
    const { doc, clock } = createDocWithParagraph();

    const result = insertAtAnchor({ doc, clock, content: "hello" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getDocumentText({ doc: result.doc })).toBe("hello");
    }
  });
});
