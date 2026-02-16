import { describe, test, expect } from "bun:test";
import { requestPermission, resolvePermission, hasPending } from "./permission-manager";

// Each test uses a unique permission ID to avoid cross-test interference
// since the module uses a global Map.

describe("hasPending", () => {
    test("returns false for unknown ID", () => {
        expect(hasPending("unknown-id")).toBe(false);
    });
});

describe("requestPermission + resolvePermission", () => {
    test("requestPermission makes hasPending return true", () => {
        const id = `perm-${Date.now()}-1`;
        requestPermission(id, "write", { path: "/tmp" });
        expect(hasPending(id)).toBe(true);
    });

    test("resolvePermission resolves the promise with correct response", async () => {
        const id = `perm-${Date.now()}-2`;
        const promise = requestPermission(id, "write", { path: "/tmp" });

        const resolved = resolvePermission(id, { decision: "allow", alwaysAllow: true, toolName: "write" });
        expect(resolved).toBe(true);
        expect(hasPending(id)).toBe(false);

        const result = await promise;
        expect(result).toEqual({ decision: "allow", alwaysAllow: true, toolName: "write" });
    });

    test("resolvePermission returns false for unknown ID", () => {
        const result = resolvePermission("nonexistent", { decision: "deny" });
        expect(result).toBe(false);
    });

    test("concurrent permissions work independently", async () => {
        const id1 = `perm-${Date.now()}-3a`;
        const id2 = `perm-${Date.now()}-3b`;

        const promise1 = requestPermission(id1, "read", {});
        const promise2 = requestPermission(id2, "write", {});

        expect(hasPending(id1)).toBe(true);
        expect(hasPending(id2)).toBe(true);

        resolvePermission(id2, { decision: "deny" });
        expect(hasPending(id1)).toBe(true);
        expect(hasPending(id2)).toBe(false);

        resolvePermission(id1, { decision: "allow" });
        expect(hasPending(id1)).toBe(false);

        const result1 = await promise1;
        const result2 = await promise2;
        expect(result1.decision).toBe("allow");
        expect(result2.decision).toBe("deny");
    });
});
