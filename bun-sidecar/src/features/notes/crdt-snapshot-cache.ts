import path from "path";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { getNotesCRDTPath } from "@/storage/root-path";

export interface NoteSnapshotMeta {
    docId: string;
    snapshotVersion?: string;
    updatedAt: string;
    stateVector?: Record<string, number>;
    source?: "local" | "remote-merged";
    lastKnownBackendVersion?: string;
}

export interface NoteSnapshotRecord {
    bytes: Uint8Array;
    meta: NoteSnapshotMeta | null;
}

function baseName(docId: string): string {
    return encodeURIComponent(docId);
}

function snapshotPath(docId: string): string {
    return path.join(getNotesCRDTPath(), `${baseName(docId)}.bin`);
}

function metaPath(docId: string): string {
    return path.join(getNotesCRDTPath(), `${baseName(docId)}.meta.json`);
}

async function atomicWriteBytes(filePath: string, data: Uint8Array): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${crypto.randomUUID()}`;
    await writeFile(tmp, data);
    await rename(tmp, filePath);
}

async function atomicWriteText(filePath: string, text: string): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${crypto.randomUUID()}`;
    await writeFile(tmp, text, "utf-8");
    await rename(tmp, filePath);
}

export async function readNoteSnapshot(params: {
    docId: string;
}): Promise<NoteSnapshotRecord | null> {
    const bytesFile = Bun.file(snapshotPath(params.docId));
    if (!(await bytesFile.exists())) {
        return null;
    }

    const bytes = new Uint8Array(await bytesFile.arrayBuffer());
    let meta: NoteSnapshotMeta | null = null;
    try {
        const metaRaw = await readFile(metaPath(params.docId), "utf-8");
        meta = JSON.parse(metaRaw) as NoteSnapshotMeta;
    } catch {
        meta = null;
    }

    return { bytes, meta };
}

export async function writeNoteSnapshot(params: {
    docId: string;
    bytes: Uint8Array;
    meta: NoteSnapshotMeta;
}): Promise<void> {
    await atomicWriteBytes(snapshotPath(params.docId), params.bytes);
    await atomicWriteText(metaPath(params.docId), JSON.stringify(params.meta, null, 2));
}

export async function deleteNoteSnapshot(params: {
    docId: string;
}): Promise<void> {
    try {
        await unlink(snapshotPath(params.docId));
    } catch {
        // ignore missing
    }
    try {
        await unlink(metaPath(params.docId));
    } catch {
        // ignore missing
    }
}

export async function listNoteSnapshots(): Promise<Array<{
    docId: string;
    hasMeta: boolean;
    byteSize: number;
}>> {
    const dir = getNotesCRDTPath();
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir);
    const output: Array<{ docId: string; hasMeta: boolean; byteSize: number }> = [];

    for (const file of entries) {
        if (!file.endsWith(".bin")) continue;
        const encoded = file.slice(0, -4);
        const docId = decodeURIComponent(encoded);
        const bytes = await Bun.file(path.join(dir, file)).arrayBuffer();
        const hasMeta = await Bun.file(path.join(dir, `${encoded}.meta.json`)).exists();
        output.push({
            docId,
            hasMeta,
            byteSize: bytes.byteLength,
        });
    }

    return output.sort((a, b) => a.docId.localeCompare(b.docId));
}
