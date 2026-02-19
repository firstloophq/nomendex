import { describe, it, expect } from "bun:test";
import {
  createCard,
  addColumn,
  removeColumn,
  moveCard,
  getBoardState,
  getCardSummary,
  getCardDetail,
  listCards,
  type CardApiState,
} from "@/crdt/server/card-api";
import { createDocManager, BOARD_DOC_ID } from "@/crdt/document/doc-manager";
import { createClock } from "@/crdt/core/lamport-clock";

function makeState(clientId?: string): CardApiState {
  return {
    manager: createDocManager(),
    clock: createClock({ clientId: clientId ?? "test-client" }),
  };
}

describe("card-api", () => {
  describe("default boardDocId (BOARD_DOC_ID)", () => {
    it("creates a card in a column", () => {
      let s = makeState();
      const r1 = addColumn({ state: s, column: "Todo" });
      s = r1.state;
      const r2 = createCard({ state: s, cardId: "c1", fields: { title: "Task 1" }, column: "Todo" });
      s = r2.state;

      const board = getBoardState({ manager: s.manager });
      expect(board.columns).toContain("Todo");
      expect(board.cardsByColumn["Todo"]?.length).toBe(1);
      expect(board.cardsByColumn["Todo"]?.[0]?.title).toBe("Task 1");
    });

    it("moves a card to a different column", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Todo" }).state;
      s = addColumn({ state: s, column: "Done" }).state;
      s = createCard({ state: s, cardId: "c1", fields: { title: "Task 1" }, column: "Todo" }).state;
      s = moveCard({ state: s, cardId: "c1", column: "Done" }).state;

      const board = getBoardState({ manager: s.manager });
      expect(board.cardsByColumn["Todo"]?.length ?? 0).toBe(0);
      expect(board.cardsByColumn["Done"]?.length).toBe(1);
    });
  });

  describe("custom boardDocId", () => {
    const CUSTOM_BOARD = "__project-alpha__";

    it("uses custom board doc for column ops", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Backlog", boardDocId: CUSTOM_BOARD }).state;
      s = addColumn({ state: s, column: "Sprint", boardDocId: CUSTOM_BOARD }).state;

      // Default board should be empty
      const defaultBoard = getBoardState({ manager: s.manager });
      expect(defaultBoard.columns.length).toBe(0);

      // Custom board should have the columns
      const customBoard = getBoardState({ manager: s.manager, boardDocId: CUSTOM_BOARD });
      expect(customBoard.columns).toContain("Backlog");
      expect(customBoard.columns).toContain("Sprint");
    });

    it("creates a card on custom board", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Todo", boardDocId: CUSTOM_BOARD }).state;
      s = createCard({
        state: s,
        cardId: "c1",
        fields: { title: "Custom Task" },
        column: "Todo",
        boardDocId: CUSTOM_BOARD,
      }).state;

      const board = getBoardState({ manager: s.manager, boardDocId: CUSTOM_BOARD });
      expect(board.cardsByColumn["Todo"]?.length).toBe(1);
      expect(board.cardsByColumn["Todo"]?.[0]?.title).toBe("Custom Task");

      // Default board should have no cards in columns
      const defaultBoard = getBoardState({ manager: s.manager });
      expect(defaultBoard.columns.length).toBe(0);
    });

    it("moves card between columns on custom board", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Todo", boardDocId: CUSTOM_BOARD }).state;
      s = addColumn({ state: s, column: "Done", boardDocId: CUSTOM_BOARD }).state;
      s = createCard({
        state: s,
        cardId: "c1",
        fields: { title: "Task" },
        column: "Todo",
        boardDocId: CUSTOM_BOARD,
      }).state;
      s = moveCard({
        state: s,
        cardId: "c1",
        column: "Done",
        boardDocId: CUSTOM_BOARD,
      }).state;

      const board = getBoardState({ manager: s.manager, boardDocId: CUSTOM_BOARD });
      expect(board.cardsByColumn["Todo"]?.length ?? 0).toBe(0);
      expect(board.cardsByColumn["Done"]?.length).toBe(1);
    });

    it("removes column from custom board", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Temp", boardDocId: CUSTOM_BOARD }).state;
      s = removeColumn({ state: s, column: "Temp", boardDocId: CUSTOM_BOARD }).state;

      const board = getBoardState({ manager: s.manager, boardDocId: CUSTOM_BOARD });
      expect(board.columns.length).toBe(0);
    });

    it("getCardSummary uses custom board for position", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Inbox", boardDocId: CUSTOM_BOARD }).state;
      s = createCard({
        state: s,
        cardId: "c1",
        fields: { title: "Hello" },
        column: "Inbox",
        boardDocId: CUSTOM_BOARD,
      }).state;

      // Without custom board, column should be null (card exists but position is on custom board)
      const summaryDefault = getCardSummary({ manager: s.manager, cardId: "c1" });
      expect(summaryDefault?.column).toBeNull();

      // With custom board, column should be "Inbox"
      const summaryCustom = getCardSummary({ manager: s.manager, cardId: "c1", boardDocId: CUSTOM_BOARD });
      expect(summaryCustom?.column).toBe("Inbox");
    });

    it("getCardDetail uses custom board for position", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Active", boardDocId: CUSTOM_BOARD }).state;
      s = createCard({
        state: s,
        cardId: "c1",
        fields: { title: "Detail Test" },
        column: "Active",
        boardDocId: CUSTOM_BOARD,
      }).state;

      const detail = getCardDetail({ manager: s.manager, cardId: "c1", boardDocId: CUSTOM_BOARD });
      expect(detail?.position?.column).toBe("Active");
    });

    it("listCards uses custom board doc to skip", () => {
      let s = makeState();
      s = addColumn({ state: s, column: "Col", boardDocId: CUSTOM_BOARD }).state;
      s = createCard({
        state: s,
        cardId: "c1",
        fields: { title: "Card" },
        column: "Col",
        boardDocId: CUSTOM_BOARD,
      }).state;

      // Using custom board ID — should list c1 and skip the custom board doc
      const cards = listCards({ manager: s.manager, boardDocId: CUSTOM_BOARD });
      expect(cards.length).toBe(1);
      expect(cards[0]?.id).toBe("c1");
    });

    it("ops target custom board docId", () => {
      let s = makeState();
      const result = addColumn({ state: s, column: "Col", boardDocId: CUSTOM_BOARD });

      // The ops should reference the custom board ID, not BOARD_DOC_ID
      expect(result.ops?.length).toBe(1);
      expect(result.ops?.[0]?.docId).toBe(CUSTOM_BOARD);
      expect(result.ops?.[0]?.docId).not.toBe(BOARD_DOC_ID);
    });
  });
});
