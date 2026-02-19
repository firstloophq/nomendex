import { useState, useEffect, useCallback, useRef } from "react";
import { BOARD_DOC_ID } from "../crdt/document/doc-manager";
import type { UserInfo } from "../crdt/network/awareness";
import { useCRDT } from "./useCRDT";

/**
 * Subscribes to awareness on the board doc and aggregates remote users
 * grouped by their `viewingDocId` into a Map<docId, UserInfo[]>.
 */
export function usePresenceByDoc(params?: { boardDocId?: string }): ReadonlyMap<string, ReadonlyArray<UserInfo>> {
  const bid = params?.boardDocId ?? BOARD_DOC_ID;
  const { clientId, subscribeAwareness } = useCRDT();
  const [presenceByDoc, setPresenceByDoc] = useState<ReadonlyMap<string, ReadonlyArray<UserInfo>>>(new Map());
  const remoteRef = useRef<Map<string, { viewingDocId?: string; user: UserInfo }>>(new Map());

  useEffect(() => {
    const unsub = subscribeAwareness({
      docId: bid,
      onAwareness({ clientId: remoteClientId, state }) {
        if (remoteClientId === clientId) return;

        remoteRef.current.set(remoteClientId, {
          viewingDocId: state.viewingDocId,
          user: state.user,
        });

        // Rebuild the grouped map
        const byDoc = new Map<string, UserInfo[]>();
        for (const [, entry] of remoteRef.current) {
          const docId = entry.viewingDocId;
          if (!docId) continue;
          let list = byDoc.get(docId);
          if (!list) {
            list = [];
            byDoc.set(docId, list);
          }
          list.push(entry.user);
        }
        setPresenceByDoc(byDoc);
      },
    });

    return () => {
      unsub();
      remoteRef.current.clear();
    };
  }, [clientId, subscribeAwareness, bid]);

  return presenceByDoc;
}

/**
 * Returns a function to broadcast presence (viewingDocId) on the board doc.
 */
export function useSendPresence(params?: { boardDocId?: string }): (viewingDocId: string | null) => void {
  const bid = params?.boardDocId ?? BOARD_DOC_ID;
  const { clientId, userInfo, sendAwareness } = useCRDT();

  return useCallback((viewingDocId: string | null) => {
    sendAwareness({
      docId: bid,
      state: {
        viewingDocId: viewingDocId ?? undefined,
        user: userInfo,
        lastUpdated: Date.now(),
      },
    });
  }, [clientId, userInfo, sendAwareness, bid]);
}
