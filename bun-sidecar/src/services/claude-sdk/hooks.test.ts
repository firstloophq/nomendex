import { describe, test, expect, mock } from "bun:test";

// Mock transitive dependencies that hooks.ts imports
mock.module("@/services/file-locks", () => ({
    acquireFileLock: () => ({ lock: null, wasCreated: false }),
    getActiveNoteFileNameForPath: async () => null,
    releaseFileLockForToolUse: () => null,
}));

const { getToolFilePath } = await import("./hooks");

describe("getToolFilePath", () => {
    test("extracts file_path", () => {
        expect(getToolFilePath({ file_path: "/tmp/a.txt" })).toBe("/tmp/a.txt");
    });

    test("extracts filePath", () => {
        expect(getToolFilePath({ filePath: "/tmp/b.txt" })).toBe("/tmp/b.txt");
    });

    test("extracts path", () => {
        expect(getToolFilePath({ path: "/tmp/c.txt" })).toBe("/tmp/c.txt");
    });

    test("prefers file_path over filePath", () => {
        expect(getToolFilePath({ file_path: "/a", filePath: "/b" })).toBe("/a");
    });

    test("returns null for undefined input", () => {
        expect(getToolFilePath(undefined)).toBeNull();
    });

    test("returns null for empty object", () => {
        expect(getToolFilePath({})).toBeNull();
    });
});
