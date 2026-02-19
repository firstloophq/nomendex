import { describe, expect, it } from "bun:test";
import {
  createStateVector,
  updateStateVector,
  missingOps,
  filterMissingOps,
  encodeStateVector,
  decodeStateVector,
  type StateVector,
  type MissingRange,
} from "@/crdt/network/state-vector";

describe("StateVector", () => {
  describe("createStateVector", () => {
    it("creates an empty state vector", () => {
      const sv = createStateVector();
      expect(sv.size).toBe(0);
    });
  });

  describe("updateStateVector", () => {
    it("tracks a single client", () => {
      let sv = createStateVector();
      sv = updateStateVector({ sv, clientId: "A", clock: 5 });
      expect(sv.get("A")).toBe(5);
    });

    it("takes the max for repeated updates", () => {
      let sv = createStateVector();
      sv = updateStateVector({ sv, clientId: "A", clock: 3 });
      sv = updateStateVector({ sv, clientId: "A", clock: 5 });
      expect(sv.get("A")).toBe(5);
    });

    it("does not decrease", () => {
      let sv = createStateVector();
      sv = updateStateVector({ sv, clientId: "A", clock: 5 });
      sv = updateStateVector({ sv, clientId: "A", clock: 2 });
      expect(sv.get("A")).toBe(5);
    });

    it("tracks multiple clients", () => {
      let sv = createStateVector();
      sv = updateStateVector({ sv, clientId: "A", clock: 5 });
      sv = updateStateVector({ sv, clientId: "B", clock: 3 });
      expect(sv.get("A")).toBe(5);
      expect(sv.get("B")).toBe(3);
    });
  });

  describe("missingOps", () => {
    it("returns empty when remote has everything", () => {
      let local = createStateVector();
      local = updateStateVector({ sv: local, clientId: "A", clock: 5 });
      local = updateStateVector({ sv: local, clientId: "B", clock: 3 });

      let remote = createStateVector();
      remote = updateStateVector({ sv: remote, clientId: "A", clock: 5 });
      remote = updateStateVector({ sv: remote, clientId: "B", clock: 3 });

      const missing = missingOps({ local, remote });
      expect(missing.length).toBe(0);
    });

    it("returns missing ranges when remote is behind", () => {
      let local = createStateVector();
      local = updateStateVector({ sv: local, clientId: "A", clock: 5 });
      local = updateStateVector({ sv: local, clientId: "B", clock: 3 });

      let remote = createStateVector();
      remote = updateStateVector({ sv: remote, clientId: "A", clock: 3 });
      remote = updateStateVector({ sv: remote, clientId: "B", clock: 3 });

      const missing = missingOps({ local, remote });
      expect(missing).toEqual([
        { clientId: "A", from: 4, to: 5 },
      ]);
    });

    it("returns entire range for unknown clients", () => {
      let local = createStateVector();
      local = updateStateVector({ sv: local, clientId: "A", clock: 5 });
      local = updateStateVector({ sv: local, clientId: "B", clock: 3 });

      const remote = createStateVector();

      const missing = missingOps({ local, remote });
      expect(missing).toContainEqual({ clientId: "A", from: 1, to: 5 });
      expect(missing).toContainEqual({ clientId: "B", from: 1, to: 3 });
    });

    it("handles remote having clients that local doesn't", () => {
      const local = createStateVector();

      let remote = createStateVector();
      remote = updateStateVector({ sv: remote, clientId: "A", clock: 5 });

      // Remote has more than local — nothing is missing from local's perspective
      const missing = missingOps({ local, remote });
      expect(missing.length).toBe(0);
    });
  });

  describe("filterMissingOps", () => {
    function makeOp(clientId: string, clock: number) {
      return { id: { clientId, clock }, data: `${clientId}:${clock}` };
    }

    it("returns empty for empty ops", () => {
      const result = filterMissingOps({
        ops: [],
        missing: [{ clientId: "A", from: 1, to: 5 }],
      });
      expect(result).toEqual([]);
    });

    it("returns empty for empty missing ranges", () => {
      const result = filterMissingOps({
        ops: [makeOp("A", 1), makeOp("A", 2)],
        missing: [],
      });
      expect(result).toEqual([]);
    });

    it("filters ops matching a single range", () => {
      const ops = [makeOp("A", 1), makeOp("A", 2), makeOp("A", 3), makeOp("A", 4)];
      const result = filterMissingOps({
        ops,
        missing: [{ clientId: "A", from: 2, to: 3 }],
      });
      expect(result).toEqual([makeOp("A", 2), makeOp("A", 3)]);
    });

    it("filters ops from multiple clients", () => {
      const ops = [
        makeOp("A", 1), makeOp("A", 2), makeOp("A", 3),
        makeOp("B", 1), makeOp("B", 2),
      ];
      const result = filterMissingOps({
        ops,
        missing: [
          { clientId: "A", from: 2, to: 3 },
          { clientId: "B", from: 1, to: 1 },
        ],
      });
      expect(result).toEqual([makeOp("A", 2), makeOp("A", 3), makeOp("B", 1)]);
    });

    it("returns nothing when ops don't match any range", () => {
      const ops = [makeOp("A", 1), makeOp("A", 2)];
      const result = filterMissingOps({
        ops,
        missing: [{ clientId: "B", from: 1, to: 5 }],
      });
      expect(result).toEqual([]);
    });

    it("includes boundary values (from and to are inclusive)", () => {
      const ops = [makeOp("A", 3), makeOp("A", 5)];
      const result = filterMissingOps({
        ops,
        missing: [{ clientId: "A", from: 3, to: 5 }],
      });
      expect(result).toEqual([makeOp("A", 3), makeOp("A", 5)]);
    });
  });

  describe("serialization", () => {
    it("round-trips through JSON", () => {
      let sv = createStateVector();
      sv = updateStateVector({ sv, clientId: "A", clock: 5 });
      sv = updateStateVector({ sv, clientId: "B", clock: 3 });

      const encoded = encodeStateVector({ sv });
      const decoded = decodeStateVector({ data: encoded });

      expect(decoded.get("A")).toBe(5);
      expect(decoded.get("B")).toBe(3);
      expect(decoded.size).toBe(2);
    });

    it("handles empty state vector", () => {
      const sv = createStateVector();
      const encoded = encodeStateVector({ sv });
      const decoded = decodeStateVector({ data: encoded });
      expect(decoded.size).toBe(0);
    });
  });
});
