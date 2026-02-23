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
};
