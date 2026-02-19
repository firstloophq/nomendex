import { describe, it, expect } from "bun:test";
import {
  recordToMarkdown,
  markdownToRecordOps,
} from "@/crdt/document/yaml-serialization";
import {
  createRecord,
  applyRecordOps,
  getField,
  getSetField,
  getBodyText,
} from "@/crdt/document/record";
import { createClock } from "@/crdt/core/lamport-clock";

describe("YAML Frontmatter Serialization", () => {
  describe("recordToMarkdown", () => {
    it("serializes an empty record to empty string", () => {
      const record = createRecord();
      expect(recordToMarkdown({ record })).toBe("");
    });

    it("serializes scalar fields as frontmatter", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\ntitle: My Card\n---",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      const md = recordToMarkdown({ record });
      expect(md).toContain("---");
      expect(md).toContain("title: My Card");
    });

    it("serializes set fields as inline YAML arrays", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\ntags: [bug, urgent]\n---",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      const md = recordToMarkdown({ record });
      expect(md).toContain("tags:");
      expect(md).toContain("bug");
      expect(md).toContain("urgent");
    });

    it("serializes body text after frontmatter", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\ntitle: Test\n---\n\nHello world",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      const md = recordToMarkdown({ record });
      expect(md).toContain("title: Test");
      expect(md).toContain("Hello world");
    });
  });

  describe("markdownToRecordOps", () => {
    it("parses frontmatter fields", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\ntitle: My Card\ndescription: A test card\n---",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      expect(getField({ record, fieldName: "title" })).toBe("My Card");
      expect(getField({ record, fieldName: "description" })).toBe("A test card");
    });

    it("parses set fields", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\ntags: [bug, urgent, v2]\n---",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      const tags = getSetField({ record, fieldName: "tags" });
      expect(tags).toContain("bug");
      expect(tags).toContain("urgent");
      expect(tags).toContain("v2");
    });

    it("parses body text", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\ntitle: Test\n---\n\nHello",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      expect(getBodyText({ record })).toBe("Hello");
    });

    it("handles markdown with no frontmatter (body only)", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "Just body text",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      expect(getBodyText({ record })).toBe("Just body text");
    });

    it("advances the clock correctly", () => {
      const clock = createClock({ clientId: "A" });
      const { clock: newClock } = markdownToRecordOps({
        markdown: "---\ntitle: Test\ntags: [a, b]\n---\n\nHi",
        clientId: "A",
        clock,
      });
      // 1 scalar field + 2 set items + 2 body chars = 5 ops
      expect(newClock.counter).toBe(5);
    });

    it("handles custom user-defined fields", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: "---\npriority: high\nassignee: alice\ndue_date: 2026-03-01\n---",
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      expect(getField({ record, fieldName: "priority" })).toBe("high");
      expect(getField({ record, fieldName: "assignee" })).toBe("alice");
      expect(getField({ record, fieldName: "due_date" })).toBe("2026-03-01");
    });

    it("handles quoted YAML values", () => {
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({
        markdown: '---\ntitle: "Hello: World"\n---',
        clientId: "A",
        clock,
      });
      const record = applyRecordOps({ record: createRecord(), ops });
      expect(getField({ record, fieldName: "title" })).toBe("Hello: World");
    });
  });

  describe("round-trip", () => {
    it("markdown → ops → record → markdown preserves content", () => {
      const original = "---\ntitle: Test Card\ndescription: A description\ntags: [bug, feature]\n---\n\nCard body here";
      const clock = createClock({ clientId: "A" });
      const { ops } = markdownToRecordOps({ markdown: original, clientId: "A", clock });
      const record = applyRecordOps({ record: createRecord(), ops });
      const result = recordToMarkdown({ record });

      expect(result).toContain("title: Test Card");
      expect(result).toContain("description: A description");
      expect(result).toContain("bug");
      expect(result).toContain("feature");
      expect(result).toContain("Card body here");
    });
  });
});
