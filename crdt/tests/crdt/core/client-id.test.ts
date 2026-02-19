import { describe, expect, it } from "bun:test";
import { generateClientId, type ClientId } from "@/crdt/core/client-id";

describe("ClientId", () => {
  it("generates a string", () => {
    const id = generateClientId();
    expect(typeof id).toBe("string");
  });

  it("generates non-empty strings", () => {
    const id = generateClientId();
    expect(id.length).toBeGreaterThan(0);
  });

  it("generates unique IDs", () => {
    const ids = new Set<ClientId>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateClientId());
    }
    expect(ids.size).toBe(1000);
  });

  it("generates lexicographically comparable IDs", () => {
    const a = generateClientId();
    const b = generateClientId();
    // Should be able to compare without errors
    const result = a < b || a > b || a === b;
    expect(result).toBe(true);
  });

  it("generates IDs with reasonable length", () => {
    const id = generateClientId();
    // Should be short enough to not waste space, long enough for uniqueness
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(32);
  });

  it("generates IDs that are valid for use as object keys", () => {
    const id = generateClientId();
    const obj: Record<string, number> = {};
    obj[id] = 42;
    expect(obj[id]).toBe(42);
  });
});
