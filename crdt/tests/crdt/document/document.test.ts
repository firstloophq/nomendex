import { describe, expect, it } from "bun:test";
import {
  createDocument,
  insertBlock,
  insertText,
  deleteText,
  deleteBlock,
  getPlainText,
  getBlockCount,
  getBlockText,
} from "@/crdt/document/document";
import { createClock, increment } from "@/crdt/core/lamport-clock";

function makeClient(id: string) {
  return { clock: createClock({ clientId: id }) };
}

describe("CRDTDocument", () => {
  describe("createDocument", () => {
    it("creates an empty document", () => {
      const doc = createDocument();
      expect(getBlockCount({ doc })).toBe(0);
      expect(getPlainText({ doc })).toBe("");
    });
  });

  describe("insertBlock", () => {
    it("inserts a paragraph block", () => {
      let doc = createDocument();
      const client = makeClient("A");
      const result = insertBlock({
        doc,
        clock: client.clock,
        blockType: "paragraph",
        index: 0,
      });
      doc = result.doc;
      expect(getBlockCount({ doc })).toBe(1);
    });

    it("inserts multiple blocks", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;

      const r2 = insertBlock({ doc, clock, blockType: "paragraph", index: 1 });
      doc = r2.doc;
      expect(getBlockCount({ doc })).toBe(2);
    });
  });

  describe("insertText", () => {
    it("inserts text into a block", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;

      const r2 = insertText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 0,
        text: "hello",
      });
      doc = r2.doc;

      expect(getPlainText({ doc })).toBe("hello");
      expect(getBlockText({ doc, blockIndex: 0 })).toBe("hello");
    });

    it("inserts text at different positions", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;

      // Insert "hlo"
      const r2 = insertText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 0,
        text: "hlo",
      });
      doc = r2.doc;
      clock = r2.clock;

      // Insert "el" at position 1 → "hello"
      const r3 = insertText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 1,
        text: "el",
      });
      doc = r3.doc;

      expect(getBlockText({ doc, blockIndex: 0 })).toBe("hello");
    });
  });

  describe("deleteText", () => {
    it("deletes text from a block", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;

      const r2 = insertText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 0,
        text: "hello",
      });
      doc = r2.doc;
      clock = r2.clock;

      // Delete "ell" (positions 1-3)
      const r3 = deleteText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 1,
        length: 3,
      });
      doc = r3.doc;

      expect(getBlockText({ doc, blockIndex: 0 })).toBe("ho");
    });
  });

  describe("deleteBlock", () => {
    it("deletes a block", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;

      const r2 = insertText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 0,
        text: "hello",
      });
      doc = r2.doc;
      clock = r2.clock;

      const r3 = insertBlock({ doc, clock, blockType: "paragraph", index: 1 });
      doc = r3.doc;
      clock = r3.clock;

      const r4 = insertText({
        doc,
        clock,
        blockIndex: 1,
        charIndex: 0,
        text: "world",
      });
      doc = r4.doc;
      clock = r4.clock;

      // Delete first block
      const r5 = deleteBlock({ doc, clock, blockIndex: 0 });
      doc = r5.doc;

      expect(getBlockCount({ doc })).toBe(1);
      expect(getPlainText({ doc })).toBe("world");
    });
  });

  describe("multi-block text", () => {
    it("renders multiple paragraphs separated by newlines", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;

      const r2 = insertText({
        doc,
        clock,
        blockIndex: 0,
        charIndex: 0,
        text: "hello",
      });
      doc = r2.doc;
      clock = r2.clock;

      const r3 = insertBlock({ doc, clock, blockType: "paragraph", index: 1 });
      doc = r3.doc;
      clock = r3.clock;

      const r4 = insertText({
        doc,
        clock,
        blockIndex: 1,
        charIndex: 0,
        text: "world",
      });
      doc = r4.doc;

      expect(getPlainText({ doc })).toBe("hello\nworld");
    });
  });

  describe("insert block between existing blocks", () => {
    it("inserts a block at a middle position", () => {
      let doc = createDocument();
      let clock = createClock({ clientId: "A" });

      const r1 = insertBlock({ doc, clock, blockType: "paragraph", index: 0 });
      doc = r1.doc;
      clock = r1.clock;
      const r1t = insertText({ doc, clock, blockIndex: 0, charIndex: 0, text: "first" });
      doc = r1t.doc;
      clock = r1t.clock;

      const r2 = insertBlock({ doc, clock, blockType: "paragraph", index: 1 });
      doc = r2.doc;
      clock = r2.clock;
      const r2t = insertText({ doc, clock, blockIndex: 1, charIndex: 0, text: "third" });
      doc = r2t.doc;
      clock = r2t.clock;

      // Insert between
      const r3 = insertBlock({ doc, clock, blockType: "paragraph", index: 1 });
      doc = r3.doc;
      clock = r3.clock;
      const r3t = insertText({ doc, clock, blockIndex: 1, charIndex: 0, text: "second" });
      doc = r3t.doc;

      expect(getPlainText({ doc })).toBe("first\nsecond\nthird");
    });
  });
});
