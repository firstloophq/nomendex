import { describe, it, expect } from "bun:test";
import {
  createLWWRegister,
  setLWWRegister,
} from "@/crdt/core/lww-register";
import type { Timestamp } from "@/crdt/core/lamport-clock";

function ts(clientId: string, clock: number): Timestamp {
  return { clientId, clock };
}

describe("LWW Register", () => {
  describe("createLWWRegister", () => {
    it("creates a register with the given value and timestamp", () => {
      const reg = createLWWRegister({ value: "hello", timestamp: ts("A", 1) });
      expect(reg.value).toBe("hello");
      expect(reg.timestamp).toEqual(ts("A", 1));
    });

    it("works with non-string types", () => {
      const reg = createLWWRegister({ value: 42, timestamp: ts("A", 1) });
      expect(reg.value).toBe(42);
    });
  });

  describe("setLWWRegister", () => {
    it("updates value when new timestamp has higher clock", () => {
      const reg = createLWWRegister({ value: "old", timestamp: ts("A", 1) });
      const updated = setLWWRegister({
        register: reg,
        value: "new",
        timestamp: ts("A", 2),
      });
      expect(updated.value).toBe("new");
      expect(updated.timestamp).toEqual(ts("A", 2));
    });

    it("keeps old value when new timestamp has lower clock", () => {
      const reg = createLWWRegister({ value: "current", timestamp: ts("A", 5) });
      const updated = setLWWRegister({
        register: reg,
        value: "stale",
        timestamp: ts("A", 3),
      });
      expect(updated.value).toBe("current");
      expect(updated.timestamp).toEqual(ts("A", 5));
    });

    it("breaks ties by clientId (lexicographic, higher wins)", () => {
      const reg = createLWWRegister({ value: "from-A", timestamp: ts("A", 1) });
      const updated = setLWWRegister({
        register: reg,
        value: "from-B",
        timestamp: ts("B", 1),
      });
      // "B" > "A" lexicographically, so B wins
      expect(updated.value).toBe("from-B");
      expect(updated.timestamp).toEqual(ts("B", 1));
    });

    it("keeps existing when tie-breaking favors existing", () => {
      const reg = createLWWRegister({ value: "from-B", timestamp: ts("B", 1) });
      const updated = setLWWRegister({
        register: reg,
        value: "from-A",
        timestamp: ts("A", 1),
      });
      // "A" < "B", so B (existing) wins
      expect(updated.value).toBe("from-B");
    });

    it("is idempotent — applying the same set twice returns same result", () => {
      const reg = createLWWRegister({ value: "old", timestamp: ts("A", 1) });
      const first = setLWWRegister({
        register: reg,
        value: "new",
        timestamp: ts("A", 2),
      });
      const second = setLWWRegister({
        register: first,
        value: "new",
        timestamp: ts("A", 2),
      });
      expect(second.value).toBe(first.value);
      expect(second.timestamp).toEqual(first.timestamp);
    });

    it("concurrent writes converge regardless of order", () => {
      const initial = createLWWRegister({ value: "init", timestamp: ts("X", 0) });

      // Two concurrent writes at same clock
      const writeA = { value: "from-A", timestamp: ts("A", 5) };
      const writeB = { value: "from-B", timestamp: ts("B", 5) };

      // Order 1: A then B
      const r1 = setLWWRegister({
        register: setLWWRegister({ register: initial, ...writeA }),
        ...writeB,
      });

      // Order 2: B then A
      const r2 = setLWWRegister({
        register: setLWWRegister({ register: initial, ...writeB }),
        ...writeA,
      });

      // Both should converge to the same value
      expect(r1.value).toBe(r2.value);
      expect(r1.timestamp).toEqual(r2.timestamp);
      // "B" > "A", so B wins
      expect(r1.value).toBe("from-B");
    });

    it("handles sequential updates correctly", () => {
      let reg = createLWWRegister({ value: "v1", timestamp: ts("A", 1) });
      reg = setLWWRegister({ register: reg, value: "v2", timestamp: ts("A", 2) });
      reg = setLWWRegister({ register: reg, value: "v3", timestamp: ts("A", 3) });
      reg = setLWWRegister({ register: reg, value: "v4", timestamp: ts("A", 4) });
      expect(reg.value).toBe("v4");
    });
  });
});
