import { describe, it, expect } from "bun:test";
import {
  getColumns,
  getCardsInColumn,
  getCardPosition,
} from "@/crdt/document/board-document";
import {
  createRecord,
  applyRecordOp,
  type FieldOp,
  type SetOp,
} from "@/crdt/document/record";
import { createOperationId } from "@/crdt/core/operations";
import { generateKeyBetween } from "@/crdt/core/fractional-index";

function makeId(clientId: string, clock: number) {
  return createOperationId({ clientId, clock });
}

function addColumnOp(params: {
  clientId: string;
  clock: number;
  column: string;
}): SetOp {
  return {
    type: "set",
    id: makeId(params.clientId, params.clock),
    fieldName: "columns",
    action: "add",
    value: params.column,
  };
}

function removeColumnOp(params: {
  clientId: string;
  clock: number;
  column: string;
  removeIds: ReadonlyArray<{ clientId: string; clock: number }>;
}): SetOp {
  return {
    type: "set",
    id: makeId(params.clientId, params.clock),
    fieldName: "columns",
    action: "remove",
    value: params.column,
    removeIds: params.removeIds.map((r) => makeId(r.clientId, r.clock)),
  };
}

function moveCardOp(params: {
  clientId: string;
  clock: number;
  cardId: string;
  column: string;
  order: string;
}): FieldOp {
  return {
    type: "field",
    id: makeId(params.clientId, params.clock),
    fieldName: `card:${params.cardId}`,
    value: JSON.stringify({ column: params.column, order: params.order }),
    timestamp: { clientId: params.clientId, clock: params.clock },
  };
}

describe("Board Document (CRDTRecord helpers)", () => {
  describe("empty board", () => {
    it("creates an empty board", () => {
      const record = createRecord();
      expect(getColumns({ record })).toEqual([]);
    });
  });

  describe("columns (OR-Set)", () => {
    it("adds a column", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "A", clock: 1, column: "Todo" }),
      });
      expect(getColumns({ record })).toEqual(["Todo"]);
    });

    it("adds multiple columns", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "A", clock: 1, column: "Todo" }),
      });
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "A", clock: 2, column: "In Progress" }),
      });
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "A", clock: 3, column: "Done" }),
      });
      const cols = getColumns({ record });
      expect(cols).toContain("Todo");
      expect(cols).toContain("In Progress");
      expect(cols).toContain("Done");
    });

    it("removes a column", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "A", clock: 1, column: "Todo" }),
      });
      record = applyRecordOp({
        record,
        op: removeColumnOp({
          clientId: "A",
          clock: 2,
          column: "Todo",
          removeIds: [{ clientId: "A", clock: 1 }],
        }),
      });
      expect(getColumns({ record })).toEqual([]);
    });

    it("concurrent add wins (OR-Set semantics)", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "A", clock: 1, column: "Todo" }),
      });
      record = applyRecordOp({
        record,
        op: addColumnOp({ clientId: "B", clock: 1, column: "Todo" }),
      });
      // Remove only A's add
      record = applyRecordOp({
        record,
        op: removeColumnOp({
          clientId: "A",
          clock: 2,
          column: "Todo",
          removeIds: [{ clientId: "A", clock: 1 }],
        }),
      });
      // B's add persists
      expect(getColumns({ record })).toEqual(["Todo"]);
    });

    it("is idempotent", () => {
      let record = createRecord();
      const op = addColumnOp({ clientId: "A", clock: 1, column: "Todo" });
      record = applyRecordOp({ record, op });
      const before = record;
      record = applyRecordOp({ record, op });
      expect(record).toBe(before);
    });
  });

  describe("card positions (LWW Register + fractional index)", () => {
    it("places a card in a column", () => {
      let record = createRecord();
      const order = generateKeyBetween({ a: null, b: null });
      record = applyRecordOp({
        record,
        op: moveCardOp({
          clientId: "A",
          clock: 1,
          cardId: "card-1",
          column: "Todo",
          order,
        }),
      });
      expect(getCardPosition({ record, cardId: "card-1" })).toEqual({
        column: "Todo",
        order,
      });
    });

    it("orders cards within a column by fractional index", () => {
      let record = createRecord();
      const order1 = generateKeyBetween({ a: null, b: null });
      const order2 = generateKeyBetween({ a: order1, b: null });
      const order3 = generateKeyBetween({ a: order1, b: order2 });

      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 1, cardId: "card-1", column: "Todo", order: order1 }),
      });
      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 2, cardId: "card-2", column: "Todo", order: order2 }),
      });
      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 3, cardId: "card-3", column: "Todo", order: order3 }),
      });

      const cards = getCardsInColumn({ record, column: "Todo" });
      expect(cards.map((c) => c.cardId)).toEqual(["card-1", "card-3", "card-2"]);
    });

    it("moves card between columns (LWW — higher timestamp wins)", () => {
      let record = createRecord();
      const order = generateKeyBetween({ a: null, b: null });

      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 1, cardId: "card-1", column: "Todo", order }),
      });
      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 2, cardId: "card-1", column: "Done", order }),
      });

      expect(getCardPosition({ record, cardId: "card-1" })?.column).toBe("Done");
      expect(getCardsInColumn({ record, column: "Todo" })).toEqual([]);
      expect(getCardsInColumn({ record, column: "Done" }).length).toBe(1);
    });

    it("concurrent moves: higher clock wins", () => {
      let record = createRecord();
      const order = generateKeyBetween({ a: null, b: null });

      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 1, cardId: "card-1", column: "Todo", order }),
      });
      // B moves to Done with higher clock
      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "B", clock: 5, cardId: "card-1", column: "Done", order }),
      });
      // A tries to move to In Progress with lower clock
      record = applyRecordOp({
        record,
        op: moveCardOp({ clientId: "A", clock: 3, cardId: "card-1", column: "In Progress", order }),
      });

      expect(getCardPosition({ record, cardId: "card-1" })?.column).toBe("Done");
    });

    it("returns undefined for non-existent card", () => {
      const record = createRecord();
      expect(getCardPosition({ record, cardId: "nope" })).toBeUndefined();
    });
  });
});
