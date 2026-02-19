import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RecordOp } from "@/crdt/document/record";
import {
  loadDocOpsFixtureFromFile,
  parseDocOpsFixture,
  saveDocOpsFixtureToFile,
} from "@/crdt/server/doc-ops-fixture";

function makeFieldOp(clock: number): RecordOp {
  return {
    type: "field",
    id: { clientId: "fixture-client", clock },
    fieldName: `tl:shape:${clock}`,
    value: JSON.stringify({ id: `shape:${clock}`, x: clock }),
    timestamp: { clientId: "fixture-client", clock },
  };
}

describe("doc-ops fixture persistence", () => {
  test("save + load round trip from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "crdt-fixture-"));
    try {
      const filePath = join(dir, "tldraw.json");
      const ops = [makeFieldOp(1), makeFieldOp(2)];
      saveDocOpsFixtureToFile({
        filePath,
        docId: "__tldraw__",
        ops,
        now: new Date("2026-02-19T12:00:00.000Z"),
      });

      const loaded = loadDocOpsFixtureFromFile({
        filePath,
        expectedDocId: "__tldraw__",
      });
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(1);
      expect(loaded!.docId).toBe("__tldraw__");
      expect(loaded!.savedAt).toBe("2026-02-19T12:00:00.000Z");
      expect(loaded!.ops).toEqual(ops);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("load returns null for missing file", () => {
    const loaded = loadDocOpsFixtureFromFile({
      filePath: join(tmpdir(), "definitely-missing-crdt-fixture.json"),
      expectedDocId: "__tldraw__",
    });
    expect(loaded).toBeNull();
  });

  test("parse rejects wrong doc id", () => {
    const json = JSON.stringify({
      version: 1,
      docId: "__other__",
      savedAt: "2026-02-19T00:00:00.000Z",
      ops: [makeFieldOp(1)],
    });
    const parsed = parseDocOpsFixture({
      json,
      expectedDocId: "__tldraw__",
    });
    expect(parsed).toBeNull();
  });

  test("save writes readable JSON fixture payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "crdt-fixture-"));
    try {
      const filePath = join(dir, "fixture.json");
      saveDocOpsFixtureToFile({
        filePath,
        docId: "__tldraw__",
        ops: [],
        now: new Date("2026-02-19T12:34:56.789Z"),
      });
      const raw = readFileSync(filePath, "utf8");
      expect(raw).toContain("\"version\": 1");
      expect(raw).toContain("\"docId\": \"__tldraw__\"");
      expect(raw).toContain("\"ops\": []");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
