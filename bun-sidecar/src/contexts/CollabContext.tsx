import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";
import { useTeamAuth } from "./AuthContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";

// The Cloudflare Worker host for WebSocket connections.
// In development (localhost), point to wrangler dev on port 8787.
// In production, this should be configured via native app injection.
function getCollabWorkerHost(): string {
    if (typeof window === "undefined") return "localhost:8787";
    const injected = (window as unknown as Record<string, string>).__COLLAB_WORKER_HOST__;
    if (injected) return injected;
    // If running on localhost, use local wrangler dev
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return "localhost:8787";
    }
    return "nomendex-collab.firstloop-team.workers.dev";
}

function getWsProtocol(): string {
    if (typeof window === "undefined") return "ws";
    const host = getCollabWorkerHost();
    // Use ws:// for localhost, wss:// for remote
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return "ws";
    return "wss";
}

interface CollabContextValue {
    ydoc: Y.Doc;
    provider: WebsocketProvider;
    awareness: Awareness;
    connected: boolean;
}

const CollabContext = createContext<CollabContextValue | null>(null);

/**
 * CollabProvider connects a shared Y.Doc to the Cloudflare Worker via WebSocket.
 * Only active when the workspace is in team mode and the user is signed in.
 *
 * Connection URL: ws(s)://{WORKER_HOST}/parties/vault-server/{vaultId}
 * Auth: JWT token passed as ?token= query parameter.
 */
export function CollabProvider(props: { vaultId: string; children: React.ReactNode }) {
    const { vaultId, children } = props;
    const { isSignedIn, getToken, userName } = useTeamAuth();
    const [connected, setConnected] = useState(false);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const destroyedRef = useRef(false);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Create a stable Y.Doc per vaultId
    const ydoc = useMemo(() => new Y.Doc(), [vaultId]); // eslint-disable-line react-hooks/exhaustive-deps

    const createProvider = useCallback(async () => {
        // Get a fresh JWT for the connection
        const token = await getToken();
        if (!token || destroyedRef.current) return;

        const host = getCollabWorkerHost();
        const protocol = getWsProtocol();

        // WebSocket URL: ws(s)://{host}/parties/vault-server/{vaultId}?token={jwt}
        const wsUrl = `${protocol}://${host}/parties/vault-server`;

        // Disable built-in reconnect — we handle it ourselves for token refresh
        const provider = new WebsocketProvider(wsUrl, vaultId, ydoc, {
            params: { token },
            connect: true,
            maxBackoffTime: 5000,
        });

        // Set user awareness for cursor display
        const userColor = generateColor(userName ?? "User");
        provider.awareness.setLocalStateField("user", {
            name: userName ?? "Anonymous",
            color: userColor,
            colorLight: `${userColor}33`, // 20% opacity
        });

        provider.on("status", (event: { status: string }) => {
            if (destroyedRef.current) return;
            setConnected(event.status === "connected");
        });

        providerRef.current = provider;
    }, [getToken, vaultId, ydoc, userName]);

    // Create provider and connect
    useEffect(() => {
        if (!isSignedIn || !vaultId) return;

        destroyedRef.current = false;
        createProvider();

        return () => {
            destroyedRef.current = true;
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (providerRef.current) {
                providerRef.current.destroy();
                providerRef.current = null;
            }
            setConnected(false);
        };
    }, [isSignedIn, vaultId, createProvider]);

    // Don't render context until we have a provider
    const provider = providerRef.current;
    if (!provider) {
        return <>{children}</>;
    }

    return (
        <CollabContext.Provider
            value={{
                ydoc,
                provider,
                awareness: provider.awareness,
                connected,
            }}
        >
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
    const { activeWorkspace } = useWorkspaceSwitcher();
    const { isSignedIn } = useTeamAuth();

    const isTeamMode = activeWorkspace?.teamMode === "team";
    const vaultId = activeWorkspace?.teamVaultId;

    if (!isTeamMode || !vaultId || !isSignedIn) {
        return <>{props.children}</>;
    }

    return <CollabProvider vaultId={vaultId}>{props.children}</CollabProvider>;
}

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
