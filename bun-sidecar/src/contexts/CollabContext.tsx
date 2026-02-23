import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createMultiDocTransport } from "@firstloophq-demos/crdt-lib";
import type { MultiDocTransport, AwarenessState, UserInfo, RecordOp } from "@firstloophq-demos/crdt-lib";
import type { StateVector } from "@firstloophq-demos/crdt-lib";
import { useTeamAuth } from "./AuthContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { crdtDebugLog, summarizeOpsForDebug } from "@-demos/crdt-lib/crdt-debug";

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
export type SnapshotListener = (params: {
    docId: string;
    snapshot: Uint8Array;
    version?: string;
}) => void;

// --- Context value ---

export interface CollabContextValue {
    readonly clientId: string;
    readonly userInfo: UserInfo;
    readonly isConnected: boolean;
    readonly subscribeDoc: (params: {
        docId: string;
        onOps: OpsListener;
        initialStateVector?: StateVector;
        onSyncComplete?: SyncCompleteListener;
        onSnapshot?: SnapshotListener;
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
    readonly sendSnapshot: (params: {
        docId: string;
        snapshot: Uint8Array;
        expectedVersion?: string;
        mergeBias?: "local" | "remote";
    }) => void;
}

const CollabContext = createContext<CollabContextValue | null>(null);

/**
 * Generate a deterministic color from a string (for cursor colors).
 */
function generateColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

function sanitizeIdentityToken(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9._:-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function getQueryIdentityOverrides(): {
    clientId: string | null;
    userName: string | null;
} {
    if (typeof window === "undefined") {
        return { clientId: null, userName: null };
    }

    const params = new URLSearchParams(window.location.search);

    const rawClientId = params.get("crdtClientId") ?? params.get("clientId");
    const rawUserId = params.get("userId");
    const rawUserName = params.get("userName") ?? rawUserId;

    const sanitizedClientId = rawClientId ? sanitizeIdentityToken(rawClientId) : "";
    const sanitizedUserId = rawUserId ? sanitizeIdentityToken(rawUserId) : "";

    const clientId = sanitizedClientId
        ? sanitizedClientId
        : (sanitizedUserId ? `e2e-${sanitizedUserId}` : null);

    const userName = rawUserName?.trim() ? rawUserName.trim() : null;

    return { clientId, userName };
}

function isQueryFlagEnabled(params: { key: string }): boolean {
    if (typeof window === "undefined") return false;
    const value = new URLSearchParams(window.location.search).get(params.key);
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
}

function isCollabTestRoute(): boolean {
    if (typeof window === "undefined") return false;
    return window.location.pathname === "/collab-test";
}

/**
 * CollabProvider connects to the local bun-sidecar CRDT WebSocket server.
 * Uses the multi-doc transport pattern from @firstloophq-demos/crdt-lib with listener registries
 * and ref-counting for document subscriptions.
 */
export function CollabProvider(props: { vaultId: string; children: React.ReactNode }) {
    const { vaultId: _vaultId, children } = props;
    const { isSignedIn, userName, getToken } = useTeamAuth();
    const [isConnected, setIsConnected] = useState(false);
    const [queryIdentity] = useState(() => getQueryIdentityOverrides());
    const [forceCollabFromQuery] = useState(() => isQueryFlagEnabled({ key: "forceCollab" }));
    const [forceCollabFromRoute] = useState(() => isCollabTestRoute());

    // Each tab needs a unique clientId — CRDTs require unique IDs per client instance.
    // Using userId by itself would cause clock conflicts between tabs of the same user,
    // so query overrides are intended for explicit test sessions with distinct user IDs.
    const [clientId] = useState(
        () => queryIdentity.clientId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const effectiveUserName = queryIdentity.userName ?? userName ?? "Anonymous";
    const userInfo: UserInfo = useMemo(() => ({
        name: effectiveUserName,
        color: generateColor(effectiveUserName || clientId),
    }), [effectiveUserName, clientId]);

    // Listener registries (same pattern as CRDTProvider in @firstloophq-demos/crdt-lib)
    const opsListenersRef = useRef(new Map<string, Set<OpsListener>>());
    const awarenessListenersRef = useRef(new Map<string, Set<AwarenessListener>>());
    const syncListenersRef = useRef(new Map<string, Set<SyncCompleteListener>>());
    const snapshotListenersRef = useRef(new Map<string, Set<SnapshotListener>>());

    // Ref-counting for transport subscriptions
    const docRefCountRef = useRef(new Map<string, number>());
    const docInitialSVRef = useRef(new Map<string, StateVector>());

    const transportRef = useRef<MultiDocTransport | null>(null);

    // Build local WebSocket URL
    const wsUrl = `ws://localhost:${window.location.port}/ws/crdt`;

    useEffect(() => {
        if (!isSignedIn && !forceCollabFromQuery && !forceCollabFromRoute) return;
        crdtDebugLog({
            event: "transport_init",
            data: {
                wsUrl,
                clientId,
                isSignedIn,
                forceCollabFromQuery,
                forceCollabFromRoute,
                queryIdentity,
            },
        });

        const transport = createMultiDocTransport({
            url: wsUrl,
            clientId,
            getAuthToken: async () => {
                const token = await getToken();
                return token ?? "";
            },
            onOps({ docId, ops }) {
                crdtDebugLog({
                    event: "transport_on_ops",
                    data: {
                        docId,
                        count: ops.length,
                        ops: summarizeOpsForDebug(ops),
                    },
                });
                const listeners = opsListenersRef.current.get(docId);
                if (listeners) {
                    for (const listener of listeners) {
                        listener({ docId, ops });
                    }
                }
            },
            onAwareness({ docId, clientId: remoteClientId, state }) {
                crdtDebugLog({
                    event: "transport_on_awareness",
                    data: {
                        docId,
                        remoteClientId,
                        hasCursor: !!state.cursor,
                        viewingDocId: state.viewingDocId ?? null,
                    },
                });
                const listeners = awarenessListenersRef.current.get(docId);
                if (listeners) {
                    for (const listener of listeners) {
                        listener({ docId, clientId: remoteClientId, state });
                    }
                }
            },
            onSnapshot({ docId, data, version }) {
                crdtDebugLog({
                    event: "transport_on_snapshot",
                    data: {
                        docId,
                        bytes: data.byteLength,
                        version: version ?? null,
                    },
                });
                const listeners = snapshotListenersRef.current.get(docId);
                if (listeners) {
                    for (const listener of listeners) {
                        listener({ docId, snapshot: data, version });
                    }
                }
            },
            onConnect() {
                setIsConnected(true);
                crdtDebugLog({ event: "transport_connected", data: { clientId } });
            },
            onDisconnect() {
                setIsConnected(false);
                crdtDebugLog({ event: "transport_disconnected", data: { clientId } });
            },
            onDocSyncComplete({ docId }) {
                crdtDebugLog({ event: "transport_sync_complete", data: { docId } });
                const listeners = syncListenersRef.current.get(docId);
                if (listeners) {
                    for (const listener of listeners) {
                        listener({ docId });
                    }
                }
            },
        });

        transportRef.current = transport;

        // Replay any pending doc subscriptions (child useEffects may have run first)
        for (const [docId, count] of docRefCountRef.current) {
            if (count > 0) {
                const sv = docInitialSVRef.current.get(docId);
                transport.subscribe({ docId, initialStateVector: sv });
                crdtDebugLog({
                    event: "transport_resubscribe",
                    data: { docId, count, hasInitialStateVector: !!sv },
                });
            }
        }

        return () => {
            transport.close();
            crdtDebugLog({ event: "transport_closed", data: { clientId } });
            transportRef.current = null;
            setIsConnected(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId, wsUrl, isSignedIn, forceCollabFromQuery, forceCollabFromRoute]);

    const subscribeDoc = useCallback((subParams: {
        docId: string;
        onOps: OpsListener;
        initialStateVector?: StateVector;
        onSyncComplete?: SyncCompleteListener;
        onSnapshot?: SnapshotListener;
    }): (() => void) => {
        const { docId, onOps, initialStateVector, onSyncComplete, onSnapshot } = subParams;

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

        if (onSnapshot) {
            let snapshotSet = snapshotListenersRef.current.get(docId);
            if (!snapshotSet) {
                snapshotSet = new Set();
                snapshotListenersRef.current.set(docId, snapshotSet);
            }
            snapshotSet.add(onSnapshot);
        }

        // Ref-count: first subscriber triggers transport.subscribe
        const prevCount = docRefCountRef.current.get(docId) ?? 0;
        docRefCountRef.current.set(docId, prevCount + 1);
        crdtDebugLog({
            event: "subscribe_doc",
            data: {
                docId,
                prevCount,
                nextCount: prevCount + 1,
                hasInitialStateVector: !!initialStateVector,
                hasSyncListener: !!onSyncComplete,
                hasSnapshotListener: !!onSnapshot,
            },
        });

        if (prevCount === 0) {
            if (initialStateVector) {
                docInitialSVRef.current.set(docId, initialStateVector);
            }
            transportRef.current?.subscribe({
                docId,
                initialStateVector: initialStateVector ?? docInitialSVRef.current.get(docId),
            });
            crdtDebugLog({
                event: "transport_subscribe_called",
                data: {
                    docId,
                    hasInitialStateVector: !!(initialStateVector ?? docInitialSVRef.current.get(docId)),
                },
            });
        }

        // Return unsubscribe function
        return () => {
            const currentOpsSet = opsListenersRef.current.get(docId);
            if (currentOpsSet) {
                currentOpsSet.delete(onOps);
                if (currentOpsSet.size === 0) {
                    opsListenersRef.current.delete(docId);
                }
            }

            if (onSyncComplete) {
                const currentSyncSet = syncListenersRef.current.get(docId);
                if (currentSyncSet) {
                    currentSyncSet.delete(onSyncComplete);
                    if (currentSyncSet.size === 0) {
                        syncListenersRef.current.delete(docId);
                    }
                }
            }

            if (onSnapshot) {
                const currentSnapshotSet = snapshotListenersRef.current.get(docId);
                if (currentSnapshotSet) {
                    currentSnapshotSet.delete(onSnapshot);
                    if (currentSnapshotSet.size === 0) {
                        snapshotListenersRef.current.delete(docId);
                    }
                }
            }

            // Ref-count: last unsubscriber triggers transport.unsubscribe
            const count = docRefCountRef.current.get(docId) ?? 1;
            if (count <= 1) {
                docRefCountRef.current.delete(docId);
                docInitialSVRef.current.delete(docId);
                transportRef.current?.unsubscribe({ docId });
                crdtDebugLog({ event: "transport_unsubscribe_called", data: { docId } });
            } else {
                docRefCountRef.current.set(docId, count - 1);
            }
            crdtDebugLog({
                event: "unsubscribe_doc",
                data: {
                    docId,
                    prevCount: count,
                    nextCount: count <= 1 ? 0 : count - 1,
                },
            });
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
        crdtDebugLog({ event: "subscribe_awareness", data: { docId, count: awarenessSet.size } });

        return () => {
            const currentSet = awarenessListenersRef.current.get(docId);
            if (currentSet) {
                currentSet.delete(onAwareness);
                if (currentSet.size === 0) {
                    awarenessListenersRef.current.delete(docId);
                }
                crdtDebugLog({
                    event: "unsubscribe_awareness",
                    data: { docId, remaining: currentSet.size },
                });
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
        crdtDebugLog({
            event: "send_awareness",
            data: {
                docId: sendParams.docId,
                hasCursor: !!sendParams.state.cursor,
                viewingDocId: sendParams.state.viewingDocId ?? null,
            },
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
        crdtDebugLog({
            event: "send_ops",
            data: {
                docId: sendParams.docId,
                count: sendParams.ops.length,
                ops: summarizeOpsForDebug(sendParams.ops),
            },
        });
    }, []);

    const sendSnapshot = useCallback((sendParams: {
        docId: string;
        snapshot: Uint8Array;
        expectedVersion?: string;
        mergeBias?: "local" | "remote";
    }) => {
        transportRef.current?.sendSnapshot?.({
            docId: sendParams.docId,
            snapshot: sendParams.snapshot,
            expectedVersion: sendParams.expectedVersion,
            mergeBias: sendParams.mergeBias,
        });
        crdtDebugLog({
            event: "send_snapshot",
            data: {
                docId: sendParams.docId,
                bytes: sendParams.snapshot.byteLength,
                expectedVersion: sendParams.expectedVersion ?? null,
                mergeBias: sendParams.mergeBias ?? null,
            },
        });
    }, []);

    const contextValue: CollabContextValue = useMemo(() => ({
        clientId,
        userInfo,
        isConnected,
        subscribeDoc,
        subscribeAwareness,
        sendAwareness,
        sendOps,
        sendSnapshot,
    }), [clientId, userInfo, isConnected, subscribeDoc, subscribeAwareness, sendAwareness, sendOps, sendSnapshot]);

    return (
        <CollabContext.Provider value={contextValue}>
            {children}
        </CollabContext.Provider>
    );
}

/**
 * Hook to access the collab context. Returns null in solo mode.
 */
export function useCollab(): CollabContextValue | null {
    return useContext(CollabContext);
}

/**
 * Wrapper that conditionally enables CollabProvider based on workspace team mode.
 */
export function CollabProviderGate(props: { children: React.ReactNode }) {
    const { activeWorkspace, appMode } = useWorkspaceSwitcher();
    const { isSignedIn } = useTeamAuth();
    const [forceCollabFromQuery] = useState(() => isQueryFlagEnabled({ key: "forceCollab" }));
    const [forceCollabFromRoute] = useState(() => isCollabTestRoute());

    const isTeamMode = appMode === "team";
    // Use teamVaultId if set, otherwise fall back to orgWorkspaceId for GitHub-backed workspaces
    const vaultId = activeWorkspace?.teamVaultId ?? activeWorkspace?.orgWorkspaceId;

    const shouldEnableCollab = forceCollabFromQuery || forceCollabFromRoute
        ? true
        : (isTeamMode && !!vaultId && isSignedIn);

    if (!shouldEnableCollab) {
        return <>{props.children}</>;
    }

    return <CollabProvider vaultId={vaultId ?? "forced-collab-vault"}>{props.children}</CollabProvider>;
}
