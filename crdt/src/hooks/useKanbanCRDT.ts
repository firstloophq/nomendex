import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClock, increment, receive } from "../crdt/core/lamport-clock";
import type { LamportClock } from "../crdt/core/lamport-clock";
import type { RecordOp } from "../crdt/document/record";
import {
  createDocManager,
  applyDocOperation,
  deleteDoc,
  BOARD_DOC_ID,
} from "../crdt/document/doc-manager";
import type { DocManager } from "../crdt/document/doc-manager";
import type { UserInfo } from "../crdt/network/awareness";
import {
  createCard,
  updateCardFields,
  addCardTags,
  removeCardTags,
  moveCard,
  addColumn,
  removeColumn,
  getBoardState,
  getCardDetail,
  type CardApiState,
} from "../crdt/server/card-api";
import { useCRDT } from "./useCRDT";
import { usePresenceByDoc, useSendPresence } from "./usePresence";

interface KanbanCRDTState {
  manager: DocManager;
  clock: LamportClock;
}

export function useKanbanCRDT(params?: { boardDocId?: string }) {
  const boardDocId = params?.boardDocId ?? BOARD_DOC_ID;
  const { clientId, sendOps, subscribeDoc, isConnected } = useCRDT();
  const presenceByDoc = usePresenceByDoc({ boardDocId });
  const sendPresence = useSendPresence({ boardDocId });

  const [state, setState] = useState<KanbanCRDTState>(() => ({
    manager: createDocManager(),
    clock: createClock({ clientId }),
  }));

  // Keep latest state in a ref so callbacks always read current state
  const stateRef = useRef<KanbanCRDTState>(state);
  stateRef.current = state;

  // Track unsub functions for card doc subscriptions
  const cardUnsubsRef = useRef<Map<string, () => void>>(new Map());

  // Stable ops handler for the board doc
  const handleBoardOps = useCallback(({ ops }: { docId: string; ops: ReadonlyArray<RecordOp> }) => {
    setState((prev) => {
      let manager = prev.manager;
      let clock = prev.clock;

      for (const op of ops) {
        manager = applyDocOperation({ manager, docId: boardDocId, op });
        if ("id" in op && op.id && typeof op.id.clock === "number") {
          clock = receive({ clock, remoteCounter: op.id.clock });
        }
      }

      return { manager, clock };
    });
  }, [boardDocId]);

  // Factory for card ops handlers
  const makeCardOpsHandler = useCallback((cardDocId: string) => {
    return ({ ops }: { docId: string; ops: ReadonlyArray<RecordOp> }) => {
      setState((prev) => {
        let manager = prev.manager;
        let clock = prev.clock;

        for (const op of ops) {
          manager = applyDocOperation({ manager, docId: cardDocId, op });
          if ("id" in op && op.id && typeof op.id.clock === "number") {
            clock = receive({ clock, remoteCounter: op.id.clock });
          }
        }

        return { manager, clock };
      });
    };
  }, []);

  // Subscribe to board doc on mount
  useEffect(() => {
    const unsub = subscribeDoc({
      docId: boardDocId,
      onOps: handleBoardOps,
    });

    return () => {
      unsub();
    };
  }, [subscribeDoc, handleBoardOps, boardDocId]);

  // Send ops over WS and apply locally
  const applyAndSend = useCallback((result: {
    state: CardApiState;
    ops?: ReadonlyArray<{ docId: string; op: RecordOp }>;
  }) => {
    setState(result.state);

    if (result.ops) {
      // Group ops by docId for efficient sending
      const byDoc = new Map<string, RecordOp[]>();
      for (const { docId, op } of result.ops) {
        let arr = byDoc.get(docId);
        if (!arr) {
          arr = [];
          byDoc.set(docId, arr);
        }
        arr.push(op);
      }
      for (const [docId, ops] of byDoc) {
        sendOps({ docId, ops });
      }
    }
  }, [sendOps]);

  // --- Mutation functions ---

  const doAddColumn = useCallback((name: string) => {
    const result = addColumn({ state: stateRef.current, column: name, boardDocId });
    applyAndSend(result);
  }, [applyAndSend, boardDocId]);

  const doRemoveColumn = useCallback((name: string) => {
    const result = removeColumn({ state: stateRef.current, column: name, boardDocId });
    applyAndSend(result);
  }, [applyAndSend, boardDocId]);

  const doCreateCard = useCallback((params: { title: string; column: string }) => {
    const cardId = crypto.randomUUID();
    const result = createCard({
      state: stateRef.current,
      cardId,
      fields: { title: params.title },
      column: params.column,
      boardDocId,
    });
    applyAndSend(result);

    // Subscribe to the new card's doc via context
    const unsub = subscribeDoc({
      docId: cardId,
      onOps: makeCardOpsHandler(cardId),
    });
    cardUnsubsRef.current.set(cardId, unsub);

    return cardId;
  }, [applyAndSend, subscribeDoc, makeCardOpsHandler, boardDocId]);

  const doDeleteCard = useCallback(async (cardId: string) => {
    // Unsubscribe from card doc
    const unsub = cardUnsubsRef.current.get(cardId);
    if (unsub) {
      unsub();
      cardUnsubsRef.current.delete(cardId);
    }

    // Remove from local state
    setState((prev) => ({
      ...prev,
      manager: deleteDoc({ manager: prev.manager, docId: cardId }),
    }));

    // Also tell the server to delete (REST — no CRDT delete op yet)
    try {
      await fetch(`/api/cards/${cardId}`, { method: "DELETE" });
    } catch {
      // Ignore fetch errors
    }
  }, []);

  const doMoveCard = useCallback((params: {
    cardId: string;
    column: string;
    beforeCardId?: string;
    afterCardId?: string;
  }) => {
    const result = moveCard({
      state: stateRef.current,
      cardId: params.cardId,
      column: params.column,
      beforeCardId: params.beforeCardId,
      afterCardId: params.afterCardId,
      boardDocId,
    });
    applyAndSend(result);
  }, [applyAndSend, boardDocId]);

  const doUpdateFields = useCallback((cardId: string, fields: Record<string, string>) => {
    const result = updateCardFields({
      state: stateRef.current,
      cardId,
      fields,
    });
    applyAndSend(result);
  }, [applyAndSend]);

  const doAddTags = useCallback((cardId: string, tags: ReadonlyArray<string>) => {
    const result = addCardTags({
      state: stateRef.current,
      cardId,
      tags,
    });
    applyAndSend(result);
  }, [applyAndSend]);

  const doRemoveTags = useCallback((cardId: string, tags: ReadonlyArray<string>) => {
    const result = removeCardTags({
      state: stateRef.current,
      cardId,
      tags,
    });
    applyAndSend(result);
  }, [applyAndSend]);

  const getCard = useCallback((cardId: string) => {
    return getCardDetail({ manager: stateRef.current.manager, cardId, boardDocId });
  }, [boardDocId]);

  // --- Derived board state ---

  const boardState = useMemo(
    () => getBoardState({ manager: state.manager, boardDocId }),
    [state.manager, boardDocId]
  );

  // --- Auto-subscribe to card docIds ---

  useEffect(() => {
    // Derive all card IDs from the board state
    const allCardIds = new Set<string>();
    for (const col of boardState.columns) {
      const cards = boardState.cardsByColumn[col];
      if (cards) {
        for (const card of cards) {
          allCardIds.add(card.cardId);
        }
      }
    }

    // Subscribe to new cards
    for (const cardId of allCardIds) {
      if (!cardUnsubsRef.current.has(cardId)) {
        const unsub = subscribeDoc({
          docId: cardId,
          onOps: makeCardOpsHandler(cardId),
        });
        cardUnsubsRef.current.set(cardId, unsub);
      }
    }

    // Unsubscribe from removed cards
    for (const [cardId, unsub] of cardUnsubsRef.current) {
      if (!allCardIds.has(cardId)) {
        unsub();
        cardUnsubsRef.current.delete(cardId);
      }
    }
  }, [boardState, subscribeDoc, makeCardOpsHandler]);

  // Cleanup all card subscriptions on unmount
  useEffect(() => {
    return () => {
      for (const [, unsub] of cardUnsubsRef.current) {
        unsub();
      }
      cardUnsubsRef.current.clear();
    };
  }, []);

  return {
    boardState,
    getCard,
    isConnected,
    presenceByDoc,
    sendPresence,
    doAddColumn,
    doRemoveColumn,
    doCreateCard,
    doDeleteCard,
    doMoveCard,
    doUpdateFields,
    doAddTags,
    doRemoveTags,
  };
}
