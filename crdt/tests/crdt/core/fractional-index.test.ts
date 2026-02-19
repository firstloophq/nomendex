import { describe, it, expect } from "bun:test";
import { generateKeyBetween } from "@/crdt/core/fractional-index";

describe("Fractional Indexing", () => {
  describe("generateKeyBetween", () => {
    it("generates a key between null and null (middle of range)", () => {
      const key = generateKeyBetween({ a: null, b: null });
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });

    it("generates a key before an existing key", () => {
      const first = generateKeyBetween({ a: null, b: null });
      const before = generateKeyBetween({ a: null, b: first });
      expect(before < first).toBe(true);
    });

    it("generates a key after an existing key", () => {
      const first = generateKeyBetween({ a: null, b: null });
      const after = generateKeyBetween({ a: first, b: null });
      expect(after > first).toBe(true);
    });

    it("generates a key between two existing keys", () => {
      const a = generateKeyBetween({ a: null, b: null });
      const b = generateKeyBetween({ a, b: null });
      const mid = generateKeyBetween({ a, b });
      expect(mid > a).toBe(true);
      expect(mid < b).toBe(true);
    });

    it("handles many insertions without collisions", () => {
      const keys: string[] = [];
      // Build a sequence of keys by always inserting at the end
      let prev: string | null = null;
      for (let i = 0; i < 100; i++) {
        const key = generateKeyBetween({ a: prev, b: null });
        if (prev !== null) {
          expect(key > prev).toBe(true);
        }
        keys.push(key);
        prev = key;
      }

      // Verify all keys are unique
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);

      // Verify sorted order matches insertion order
      const sorted = [...keys].sort();
      expect(sorted).toEqual(keys);
    });

    it("handles many insertions between two keys", () => {
      let a = generateKeyBetween({ a: null, b: null });
      let b = generateKeyBetween({ a, b: null });

      const between: string[] = [];
      for (let i = 0; i < 50; i++) {
        const mid = generateKeyBetween({ a, b });
        expect(mid > a).toBe(true);
        expect(mid < b).toBe(true);
        between.push(mid);
        // Narrow the range — alternate between left and right insertion
        if (i % 2 === 0) {
          a = mid;
        } else {
          b = mid;
        }
      }

      // All keys unique
      const unique = new Set(between);
      expect(unique.size).toBe(between.length);
    });

    it("throws when a >= b", () => {
      expect(() => generateKeyBetween({ a: "b", b: "a" })).toThrow();
      expect(() => generateKeyBetween({ a: "a", b: "a" })).toThrow();
    });

    it("handles prepending many items at the start", () => {
      const keys: string[] = [];
      let next: string | null = null;
      for (let i = 0; i < 50; i++) {
        const key = generateKeyBetween({ a: null, b: next });
        if (next !== null) {
          expect(key < next).toBe(true);
        }
        keys.push(key);
        next = key;
      }

      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });
  });
});
