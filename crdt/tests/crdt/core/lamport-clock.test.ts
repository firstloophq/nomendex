import { describe, expect, it } from "bun:test";
import {
  createClock,
  increment,
  receive,
  compareTimestamps,
  type Timestamp,
} from "@/crdt/core/lamport-clock";

describe("LamportClock", () => {
  describe("createClock", () => {
    it("creates a clock with counter 0", () => {
      const clock = createClock({ clientId: "A" });
      expect(clock.clientId).toBe("A");
      expect(clock.counter).toBe(0);
    });
  });

  describe("increment", () => {
    it("increments from 0 to 1", () => {
      const clock = createClock({ clientId: "A" });
      const { clock: next, timestamp } = increment({ clock });
      expect(next.counter).toBe(1);
      expect(timestamp.clientId).toBe("A");
      expect(timestamp.clock).toBe(1);
    });

    it("increments sequentially", () => {
      let clock = createClock({ clientId: "A" });
      const results: Array<Timestamp> = [];
      for (let i = 0; i < 5; i++) {
        const result = increment({ clock });
        clock = result.clock;
        results.push(result.timestamp);
      }
      expect(results.map((t) => t.clock)).toEqual([1, 2, 3, 4, 5]);
    });

    it("does not mutate the original clock", () => {
      const clock = createClock({ clientId: "A" });
      increment({ clock });
      expect(clock.counter).toBe(0);
    });
  });

  describe("receive", () => {
    it("advances past remote timestamp when remote is ahead", () => {
      const clock = createClock({ clientId: "A" });
      const updated = receive({ clock, remoteCounter: 5 });
      expect(updated.counter).toBe(6);
    });

    it("advances past local when local is ahead", () => {
      let clock = createClock({ clientId: "A" });
      // Advance local to 5
      for (let i = 0; i < 5; i++) {
        clock = increment({ clock }).clock;
      }
      expect(clock.counter).toBe(5);
      const updated = receive({ clock, remoteCounter: 2 });
      expect(updated.counter).toBe(6);
    });

    it("takes max of local and remote, then increments", () => {
      const clock = createClock({ clientId: "A" });
      // local=0, remote=10 → max(0,10)+1 = 11
      const updated = receive({ clock, remoteCounter: 10 });
      expect(updated.counter).toBe(11);
    });

    it("does not mutate the original clock", () => {
      const clock = createClock({ clientId: "A" });
      receive({ clock, remoteCounter: 5 });
      expect(clock.counter).toBe(0);
    });
  });

  describe("compareTimestamps", () => {
    it("returns negative when a has lower clock", () => {
      const a: Timestamp = { clientId: "A", clock: 1 };
      const b: Timestamp = { clientId: "A", clock: 2 };
      expect(compareTimestamps({ a, b })).toBeLessThan(0);
    });

    it("returns positive when a has higher clock", () => {
      const a: Timestamp = { clientId: "A", clock: 5 };
      const b: Timestamp = { clientId: "A", clock: 2 };
      expect(compareTimestamps({ a, b })).toBeGreaterThan(0);
    });

    it("tiebreaks by clientId when clocks are equal", () => {
      const a: Timestamp = { clientId: "A", clock: 3 };
      const b: Timestamp = { clientId: "B", clock: 3 };
      // "A" < "B" so a should come first (negative result)
      expect(compareTimestamps({ a, b })).toBeLessThan(0);
    });

    it("returns 0 for identical timestamps", () => {
      const a: Timestamp = { clientId: "A", clock: 3 };
      const b: Timestamp = { clientId: "A", clock: 3 };
      expect(compareTimestamps({ a, b })).toBe(0);
    });

    it("provides deterministic ordering for different clientIds", () => {
      const timestamps: Array<Timestamp> = [
        { clientId: "C", clock: 1 },
        { clientId: "A", clock: 1 },
        { clientId: "B", clock: 1 },
      ];
      const sorted = [...timestamps].sort((a, b) =>
        compareTimestamps({ a, b })
      );
      expect(sorted.map((t) => t.clientId)).toEqual(["A", "B", "C"]);
    });
  });

  describe("serialization", () => {
    it("timestamps round-trip through JSON", () => {
      const ts: Timestamp = { clientId: "test-client", clock: 42 };
      const json = JSON.stringify(ts);
      const parsed = JSON.parse(json) as Timestamp;
      expect(parsed).toEqual(ts);
    });

    it("clock state round-trips through JSON", () => {
      let clock = createClock({ clientId: "test" });
      clock = increment({ clock }).clock;
      clock = increment({ clock }).clock;
      const json = JSON.stringify(clock);
      const parsed = JSON.parse(json) as typeof clock;
      expect(parsed).toEqual(clock);
    });
  });
});
