import { describe, it, expect } from "bun:test";
import {
  createORSet,
  addToSet,
  removeFromSet,
  getSetValues,
} from "@/crdt/core/or-set";
import { createOperationId } from "@/crdt/core/operations";

function makeId(clientId: string, clock: number) {
  return createOperationId({ clientId, clock });
}

describe("OR-Set", () => {
  describe("createORSet", () => {
    it("creates an empty set", () => {
      const set = createORSet<string>();
      expect(getSetValues({ set })).toEqual([]);
    });
  });

  describe("addToSet", () => {
    it("adds a value to the set", () => {
      let set = createORSet<string>();
      set = addToSet({ set, value: "tag1", id: makeId("A", 1) });
      expect(getSetValues({ set })).toEqual(["tag1"]);
    });

    it("adds multiple distinct values", () => {
      let set = createORSet<string>();
      set = addToSet({ set, value: "tag1", id: makeId("A", 1) });
      set = addToSet({ set, value: "tag2", id: makeId("A", 2) });
      const values = getSetValues({ set });
      expect(values).toContain("tag1");
      expect(values).toContain("tag2");
      expect(values.length).toBe(2);
    });

    it("multiple adds of same value keep only one in getSetValues", () => {
      let set = createORSet<string>();
      set = addToSet({ set, value: "tag1", id: makeId("A", 1) });
      set = addToSet({ set, value: "tag1", id: makeId("B", 1) });
      // Both adds exist internally, but getSetValues deduplicates
      expect(getSetValues({ set })).toEqual(["tag1"]);
    });

    it("is idempotent — adding same id twice has no effect", () => {
      let set = createORSet<string>();
      set = addToSet({ set, value: "tag1", id: makeId("A", 1) });
      const before = set;
      set = addToSet({ set, value: "tag1", id: makeId("A", 1) });
      expect(set).toBe(before); // reference equality — unchanged
    });
  });

  describe("removeFromSet", () => {
    it("removes a value by targeting its add id", () => {
      let set = createORSet<string>();
      const addId = makeId("A", 1);
      set = addToSet({ set, value: "tag1", id: addId });
      set = removeFromSet({ set, value: "tag1", removeIds: [addId] });
      expect(getSetValues({ set })).toEqual([]);
    });

    it("only removes targeted add ids, not all adds of same value", () => {
      let set = createORSet<string>();
      const id1 = makeId("A", 1);
      const id2 = makeId("B", 1);
      set = addToSet({ set, value: "tag1", id: id1 });
      set = addToSet({ set, value: "tag1", id: id2 });

      // Remove only id1
      set = removeFromSet({ set, value: "tag1", removeIds: [id1] });
      // id2 is still active, so "tag1" should still be present
      expect(getSetValues({ set })).toEqual(["tag1"]);
    });

    it("removing all adds of a value removes it from the set", () => {
      let set = createORSet<string>();
      const id1 = makeId("A", 1);
      const id2 = makeId("B", 1);
      set = addToSet({ set, value: "tag1", id: id1 });
      set = addToSet({ set, value: "tag1", id: id2 });

      set = removeFromSet({ set, value: "tag1", removeIds: [id1, id2] });
      expect(getSetValues({ set })).toEqual([]);
    });

    it("removing from empty set is a no-op", () => {
      let set = createORSet<string>();
      const before = set;
      set = removeFromSet({ set, value: "tag1", removeIds: [makeId("A", 1)] });
      expect(set).toBe(before);
    });

    it("removing a non-existent value is a no-op", () => {
      let set = createORSet<string>();
      set = addToSet({ set, value: "tag1", id: makeId("A", 1) });
      const before = set;
      set = removeFromSet({ set, value: "tag2", removeIds: [makeId("A", 1)] });
      expect(set).toBe(before);
    });
  });

  describe("concurrent add + remove (add wins)", () => {
    it("concurrent add wins over remove of different id", () => {
      // Client A adds "tag1" with id A:1
      // Client B concurrently adds "tag1" with id B:1
      // Then Client A removes B's add (A:1 targets B:1's id)
      // But A's own add (A:1) is untouched — element persists

      let set = createORSet<string>();
      const idA = makeId("A", 1);
      const idB = makeId("B", 1);

      set = addToSet({ set, value: "tag1", id: idA });
      set = addToSet({ set, value: "tag1", id: idB });

      // Remove only A's add
      set = removeFromSet({ set, value: "tag1", removeIds: [idA] });
      // B's add still active → "tag1" persists
      expect(getSetValues({ set })).toEqual(["tag1"]);
    });

    it("add after remove re-adds the element", () => {
      let set = createORSet<string>();
      const id1 = makeId("A", 1);
      set = addToSet({ set, value: "tag1", id: id1 });
      set = removeFromSet({ set, value: "tag1", removeIds: [id1] });
      expect(getSetValues({ set })).toEqual([]);

      // Re-add with a new id
      const id2 = makeId("A", 2);
      set = addToSet({ set, value: "tag1", id: id2 });
      expect(getSetValues({ set })).toEqual(["tag1"]);
    });
  });

  describe("convergence", () => {
    it("converges regardless of operation order", () => {
      const idA1 = makeId("A", 1);
      const idB1 = makeId("B", 1);
      const idA2 = makeId("A", 2);

      // Scenario: A adds "x", B adds "x", A removes B's add, B adds "y"
      // Order 1: A:add(x) → B:add(x) → A:remove(x, [B:1]) → B:add(y)
      let s1 = createORSet<string>();
      s1 = addToSet({ set: s1, value: "x", id: idA1 });
      s1 = addToSet({ set: s1, value: "x", id: idB1 });
      s1 = removeFromSet({ set: s1, value: "x", removeIds: [idB1] });
      s1 = addToSet({ set: s1, value: "y", id: idA2 });

      // Order 2: B:add(x) → B:add(y) → A:add(x) → A:remove(x, [B:1])
      let s2 = createORSet<string>();
      s2 = addToSet({ set: s2, value: "x", id: idB1 });
      s2 = addToSet({ set: s2, value: "y", id: idA2 });
      s2 = addToSet({ set: s2, value: "x", id: idA1 });
      s2 = removeFromSet({ set: s2, value: "x", removeIds: [idB1] });

      const v1 = getSetValues({ set: s1 }).slice().sort();
      const v2 = getSetValues({ set: s2 }).slice().sort();
      expect(v1).toEqual(v2);
      // "x" should be present (A's add is untouched), "y" should be present
      expect(v1).toContain("x");
      expect(v1).toContain("y");
    });
  });
});
