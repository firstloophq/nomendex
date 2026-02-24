import {
    deleteCanvasSnapshot,
    listCanvasSnapshots,
    readCanvasSnapshot,
    writeCanvasSnapshot,
    type CanvasSnapshotMeta,
} from "@/features/canvas/crdt-snapshot-cache";
import {
    deleteNoteSnapshot,
    listNoteSnapshots,
    readNoteSnapshot,
    writeNoteSnapshot,
    type NoteSnapshotMeta,
} from "@/features/notes/crdt-snapshot-cache";
import { getCurrentAuthToken } from "./auth-routes";

const DEFAULT_TEAM_BACKEND_HTTP_URL = "http://localhost:4444";

function resolveTeamBackendHttpUrl(): string {
    return (
        process.env.TEAM_BACKEND_HTTP_URL?.trim()
        || process.env.TEAM_BACKEND_URL?.trim()
        || DEFAULT_TEAM_BACKEND_HTTP_URL
    ).replace(/\/+$/, "");
}

function fromBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function toBase64(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data));
}

export const crdtRoutes = {
    "/api/crdt/note-snapshot/get": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId: string };
            const result = await readNoteSnapshot({ docId: args.docId });
            if (!result) {
                return Response.json({ snapshot: null, meta: null });
            }
            return Response.json({
                snapshot: toBase64(result.bytes),
                meta: result.meta,
            });
        },
    },
    "/api/crdt/note-snapshot/save": {
        async POST(req: Request) {
            const args = (await req.json()) as {
                docId: string;
                snapshot: string;
                meta?: NoteSnapshotMeta;
            };
            const bytes = fromBase64(args.snapshot);
            const meta: NoteSnapshotMeta = {
                docId: args.docId,
                updatedAt: new Date().toISOString(),
                ...(args.meta ?? {}),
            };
            await writeNoteSnapshot({
                docId: args.docId,
                bytes,
                meta,
            });
            return Response.json({ success: true, updatedAt: meta.updatedAt });
        },
    },
    "/api/crdt/note-snapshot/delete": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId: string };
            await deleteNoteSnapshot({ docId: args.docId });
            return Response.json({ success: true });
        },
    },
    "/api/crdt/note-snapshot/list": {
        async POST() {
            const snapshots = await listNoteSnapshots();
            return Response.json({ snapshots });
        },
    },
    "/api/crdt/note-snapshot/hard-reset": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId?: string };
            const docId = args.docId?.trim();
            if (!docId) {
                return Response.json({ error: "docId is required" }, { status: 400 });
            }

            await deleteNoteSnapshot({ docId });

            const token = await getCurrentAuthToken();
            if (!token) {
                return Response.json({ error: "Not authenticated" }, { status: 401 });
            }

            const teamBackendUrl = resolveTeamBackendHttpUrl();
            const response = await fetch(`${teamBackendUrl}/api/collab/reset-doc`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ docId }),
            });

            if (!response.ok) {
                const payload = await response.text().catch(() => "");
                return Response.json({
                    error: `Backend hard reset failed (${response.status})`,
                    details: payload || null,
                }, { status: response.status });
            }

            return Response.json({ success: true });
        },
    },
    "/api/crdt/note-bootstrap/get": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId?: string };
            const docId = args.docId?.trim();
            if (!docId) {
                return Response.json({ error: "docId is required" }, { status: 400 });
            }

            const local = await readNoteSnapshot({ docId });
            let remote: {
                snapshot: string | null;
                meta: {
                    snapshotVersion: string | null;
                    source: "live" | "persisted" | "none";
                    bytes: number;
                } | null;
            } = { snapshot: null, meta: null };
            let remoteError: string | null = null;

            try {
                const token = await getCurrentAuthToken();
                if (token) {
                    const teamBackendUrl = resolveTeamBackendHttpUrl();
                    const response = await fetch(`${teamBackendUrl}/api/collab/bootstrap-snapshot`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ docId }),
                    });
                    if (response.ok) {
                        remote = await response.json() as typeof remote;
                    } else {
                        remoteError = `backend_bootstrap_${response.status}`;
                    }
                } else {
                    remoteError = "missing_auth_token";
                }
            } catch (error) {
                remoteError = error instanceof Error ? error.message : String(error);
            }

            return Response.json({
                local: local
                    ? {
                        snapshot: toBase64(local.bytes),
                        meta: local.meta,
                    }
                    : null,
                remote,
                remoteError,
            });
        },
    },
    "/api/crdt/canvas-snapshot/get": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId: string };
            const result = await readCanvasSnapshot({ docId: args.docId });
            if (!result) {
                return Response.json({ snapshot: null, meta: null });
            }
            return Response.json({
                snapshot: toBase64(result.bytes),
                meta: result.meta,
            });
        },
    },
    "/api/crdt/canvas-snapshot/save": {
        async POST(req: Request) {
            const args = (await req.json()) as {
                docId: string;
                snapshot: string;
                meta?: CanvasSnapshotMeta;
            };
            const bytes = fromBase64(args.snapshot);
            const meta: CanvasSnapshotMeta = {
                docId: args.docId,
                updatedAt: new Date().toISOString(),
                ...(args.meta ?? {}),
            };
            await writeCanvasSnapshot({
                docId: args.docId,
                bytes,
                meta,
            });
            return Response.json({ success: true, updatedAt: meta.updatedAt });
        },
    },
    "/api/crdt/canvas-snapshot/delete": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId: string };
            await deleteCanvasSnapshot({ docId: args.docId });
            return Response.json({ success: true });
        },
    },
    "/api/crdt/canvas-snapshot/list": {
        async POST() {
            const snapshots = await listCanvasSnapshots();
            return Response.json({ snapshots });
        },
    },
    "/api/crdt/canvas-snapshot/hard-reset": {
        async POST(req: Request) {
            const args = (await req.json()) as { docId?: string };
            const docId = args.docId?.trim();
            if (!docId) {
                return Response.json({ error: "docId is required" }, { status: 400 });
            }

            await deleteCanvasSnapshot({ docId });

            const token = await getCurrentAuthToken();
            if (!token) {
                return Response.json({ error: "Not authenticated" }, { status: 401 });
            }

            const teamBackendUrl = resolveTeamBackendHttpUrl();
            const response = await fetch(`${teamBackendUrl}/api/collab/reset-doc`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ docId }),
            });

            if (!response.ok) {
                const payload = await response.text().catch(() => "");
                return Response.json({
                    error: `Backend hard reset failed (${response.status})`,
                    details: payload || null,
                }, { status: response.status });
            }

            return Response.json({ success: true });
        },
    },
};
