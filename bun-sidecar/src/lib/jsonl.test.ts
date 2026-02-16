import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readJSONL, appendJSONL, updateJSONL } from "./jsonl";

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "jsonl-test-"));
});

describe("readJSONL", () => {
    test("returns empty array for missing file", async () => {
        const result = await readJSONL(join(tempDir, "nonexistent.jsonl"));
        expect(result).toEqual([]);
    });

    test("reads valid JSONL", async () => {
        const filePath = join(tempDir, "data.jsonl");
        await Bun.write(filePath, '{"id":"1","name":"a"}\n{"id":"2","name":"b"}\n');
        const result = await readJSONL<{ id: string; name: string }>(filePath);
        expect(result).toEqual([
            { id: "1", name: "a" },
            { id: "2", name: "b" },
        ]);
    });

    test("skips empty lines", async () => {
        const filePath = join(tempDir, "data.jsonl");
        await Bun.write(filePath, '{"id":"1"}\n\n{"id":"2"}\n\n');
        const result = await readJSONL<{ id: string }>(filePath);
        expect(result).toHaveLength(2);
    });
});

describe("appendJSONL", () => {
    test("creates directory and file if missing", async () => {
        const filePath = join(tempDir, "nested", "dir", "data.jsonl");
        await appendJSONL(filePath, { id: "1", value: "hello" });
        const result = await readJSONL<{ id: string; value: string }>(filePath);
        expect(result).toEqual([{ id: "1", value: "hello" }]);
    });

    test("appends to existing file", async () => {
        const filePath = join(tempDir, "data.jsonl");
        await appendJSONL(filePath, { id: "1" });
        await appendJSONL(filePath, { id: "2" });
        const result = await readJSONL<{ id: string }>(filePath);
        expect(result).toEqual([{ id: "1" }, { id: "2" }]);
    });
});

describe("updateJSONL", () => {
    test("updates matching item", async () => {
        const filePath = join(tempDir, "data.jsonl");
        await Bun.write(filePath, '{"id":"1","name":"old"}\n{"id":"2","name":"keep"}\n');
        await updateJSONL<{ id: string; name: string }>(filePath, "1", (item) => ({
            ...item,
            name: "new",
        }));
        const result = await readJSONL<{ id: string; name: string }>(filePath);
        expect(result).toEqual([
            { id: "1", name: "new" },
            { id: "2", name: "keep" },
        ]);
    });

    test("leaves non-matching items unchanged", async () => {
        const filePath = join(tempDir, "data.jsonl");
        await Bun.write(filePath, '{"id":"1","name":"a"}\n{"id":"2","name":"b"}\n');
        await updateJSONL<{ id: string; name: string }>(filePath, "999", (item) => ({
            ...item,
            name: "changed",
        }));
        const result = await readJSONL<{ id: string; name: string }>(filePath);
        expect(result).toEqual([
            { id: "1", name: "a" },
            { id: "2", name: "b" },
        ]);
    });
});
