import {
  createContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { generateClientId } from "../crdt/core/client-id";
import { createMultiDocTransport } from "../crdt/network/multi-doc-transport";
import type { MultiDocTransport } from "../crdt/network/multi-doc-transport";
import type { RecordOp } from "../crdt/document/record";
import type { AwarenessState, UserInfo } from "../crdt/network/awareness";
import type { StateVector } from "../crdt/network/state-vector";

// --- Color assignment ---

const PRESENCE_COLORS = [
  "#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#be123c", "#4f46e5",
];

export function colorForClient(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash * 31 + clientId.charCodeAt(i)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]!;
}

// --- Listener types ---

export type OpsListener = (params: {
  docId: string;
  ops: ReadonlyArray<RecordOp>;
}) => void;

export type AwarenessListener = (params: {
  docId: string;
  clientId: string;
  state: AwarenessState;
}) => void;

export type SyncCompleteListener = (params: { docId: string }) => void;

// --- Context value ---

export interface CRDTContextValue {
  readonly clientId: string;
  readonly userInfo: UserInfo;
  readonly isConnected: boolean;
  readonly subscribeDoc: (params: {
    docId: string;
    onOps: OpsListener;
    initialStateVector?: StateVector;
    onSyncComplete?: SyncCompleteListener;
  }) => () => void;
  readonly subscribeAwareness: (params: {
    docId: string;
    onAwareness: AwarenessListener;
  }) => () => void;
  readonly sendAwareness: (params: {
    docId: string;
    state: AwarenessState;
  }) => void;
  readonly sendOps: (params: {
    docId: string;
    ops: ReadonlyArray<RecordOp>;
  }) => void;
  readonly disconnect: () => void;
  readonly reconnect: () => void;
  readonly pendingOpsCount: () => number;
}

export const CRDTContext = createContext<CRDTContextValue | null>(null);

// --- Provider ---

interface CRDTProviderProps {
  readonly children: ReactNode;
  readonly url?: string;
  readonly getAuthToken?: () => string | Promise<string>;
}

export function CRDTProvider(params: CRDTProviderProps) {
  const [clientId] = useState(() => generateClientId());
  const [userInfo] = useState<UserInfo>(() => ({
    name: clientId.slice(0, 6),
    color: colorForClient(clientId),
  }));
  const [isConnected, setIsConnected] = useState(false);

  // Listener registries
  const opsListenersRef = useRef(new Map<string, Set<OpsListener>>());
  const awarenessListenersRef = useRef(new Map<string, Set<AwarenessListener>>());
  const syncListenersRef = useRef(new Map<string, Set<SyncCompleteListener>>());

  // Ref-counting for transport subscriptions
  const docRefCountRef = useRef(new Map<string, number>());
  // Track initial state vectors per-doc (first subscriber wins)
  const docInitialSVRef = useRef(new Map<string, StateVector>());

  const transportRef = useRef<MultiDocTransport | null>(null);

  // Build the WebSocket URL
  const wsUrl = params.url ?? (() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  })();

  useEffect(() => {
    const transport = createMultiDocTransport({
      url: wsUrl,
      clientId,
      getAuthToken: params.getAuthToken,
      onOps({ docId, ops }) {
        const listeners = opsListenersRef.current.get(docId);
        if (listeners) {
          for (const listener of listeners) {
            listener({ docId, ops });
          }
        }
      },
      onAwareness({ docId, clientId: remoteClientId, state }) {
        const listeners = awarenessListenersRef.current.get(docId);
        if (listeners) {
          for (const listener of listeners) {
            listener({ docId, clientId: remoteClientId, state });
          }
        }
      },
      onConnect() {
        setIsConnected(true);
      },
      onDisconnect() {
        setIsConnected(false);
      },
      onDocSyncComplete({ docId }) {
        const listeners = syncListenersRef.current.get(docId);
        if (listeners) {
          for (const listener of listeners) {
            listener({ docId });
          }
        }
      },
    });

    transportRef.current = transport;

    // Child useEffects run before parent useEffects in React, so children
    // may have already called subscribeDoc before the transport exists.
    // Replay all pending doc subscriptions now that the transport is ready.
    for (const [docId, count] of docRefCountRef.current) {
      if (count > 0) {
        const sv = docInitialSVRef.current.get(docId);
        transport.subscribe({ docId, initialStateVector: sv });
      }
    }

    return () => {
      transport.close();
      transportRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, wsUrl]);

  const subscribeDoc = useCallback((subParams: {
    docId: string;
    onOps: OpsListener;
    initialStateVector?: StateVector;
    onSyncComplete?: SyncCompleteListener;
  }): (() => void) => {
    const { docId, onOps, initialStateVector, onSyncComplete } = subParams;

    // Register ops listener
    let opsSet = opsListenersRef.current.get(docId);
    if (!opsSet) {
      opsSet = new Set();
      opsListenersRef.current.set(docId, opsSet);
    }
    opsSet.add(onOps);

    // Register sync listener if provided
    if (onSyncComplete) {
      let syncSet = syncListenersRef.current.get(docId);
      if (!syncSet) {
        syncSet = new Set();
        syncListenersRef.current.set(docId, syncSet);
      }
      syncSet.add(onSyncComplete);
    }

    // Ref-count: first subscriber triggers transport.subscribe
    const prevCount = docRefCountRef.current.get(docId) ?? 0;
    docRefCountRef.current.set(docId, prevCount + 1);

    if (prevCount === 0) {
      // Store initial SV for this doc
      if (initialStateVector) {
        docInitialSVRef.current.set(docId, initialStateVector);
      }
      transportRef.current?.subscribe({
        docId,
        initialStateVector: initialStateVector ?? docInitialSVRef.current.get(docId),
      });
    }

    // Return unsubscribe function
    return () => {
      // Remove ops listener
      const currentOpsSet = opsListenersRef.current.get(docId);
      if (currentOpsSet) {
        currentOpsSet.delete(onOps);
        if (currentOpsSet.size === 0) {
          opsListenersRef.current.delete(docId);
        }
      }

      // Remove sync listener
      if (onSyncComplete) {
        const currentSyncSet = syncListenersRef.current.get(docId);
        if (currentSyncSet) {
          currentSyncSet.delete(onSyncComplete);
          if (currentSyncSet.size === 0) {
            syncListenersRef.current.delete(docId);
          }
        }
      }

      // Ref-count: last unsubscriber triggers transport.unsubscribe
      const count = docRefCountRef.current.get(docId) ?? 1;
      if (count <= 1) {
        docRefCountRef.current.delete(docId);
        docInitialSVRef.current.delete(docId);
        transportRef.current?.unsubscribe({ docId });
      } else {
        docRefCountRef.current.set(docId, count - 1);
      }
    };
  }, []);

  const subscribeAwareness = useCallback((subParams: {
    docId: string;
    onAwareness: AwarenessListener;
  }): (() => void) => {
    const { docId, onAwareness } = subParams;

    let awarenessSet = awarenessListenersRef.current.get(docId);
    if (!awarenessSet) {
      awarenessSet = new Set();
      awarenessListenersRef.current.set(docId, awarenessSet);
    }
    awarenessSet.add(onAwareness);

    return () => {
      const currentSet = awarenessListenersRef.current.get(docId);
      if (currentSet) {
        currentSet.delete(onAwareness);
        if (currentSet.size === 0) {
          awarenessListenersRef.current.delete(docId);
        }
      }
    };
  }, []);

  const sendAwareness = useCallback((sendParams: {
    docId: string;
    state: AwarenessState;
  }) => {
    transportRef.current?.sendAwareness({
      docId: sendParams.docId,
      clientId,
      state: sendParams.state,
    });
  }, [clientId]);

  const sendOps = useCallback((sendParams: {
    docId: string;
    ops: ReadonlyArray<RecordOp>;
  }) => {
    transportRef.current?.send({
      docId: sendParams.docId,
      ops: sendParams.ops,
    });
  }, []);

  const disconnect = useCallback(() => {
    transportRef.current?.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    transportRef.current?.reconnect();
  }, []);

  const pendingOpsCount = useCallback(() => {
    return transportRef.current?.pendingOpsCount() ?? 0;
  }, []);

  const contextValue: CRDTContextValue = {
    clientId,
    userInfo,
    isConnected,
    subscribeDoc,
    subscribeAwareness,
    sendAwareness,
    sendOps,
    disconnect,
    reconnect,
    pendingOpsCount,
  };

  return (
    <CRDTContext.Provider value={contextValue}>
      {params.children}
    </CRDTContext.Provider>
  );
}
