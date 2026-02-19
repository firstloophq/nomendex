import { createServiceLogger } from "@/lib/logger";
import { FeatureStorage } from "@/storage/FeatureStorage";
import { getCanvasesPath, hasActiveWorkspace } from "@/storage/root-path";
import { CanvasItem, CanvasItemSchema } from "./index";
import { z } from "zod";

const canvasLogger = createServiceLogger("CANVAS");

const INDEX_FILE = "index.json";

const CanvasIndexSchema = z.object({
    version: z.literal(1),
    items: z.array(CanvasItemSchema),
});

type CanvasIndex = z.infer<typeof CanvasIndexSchema>;

let storage: FeatureStorage | null = null;

function nowIso(): string {
    return new Date().toISOString();
}

function normalizeTitle(title: string | undefined): string {
    const trimmed = title?.trim();
    if (!trimmed) return "Untitled Canvas";
    return trimmed;
}

function sortByUpdatedAtDesc(items: ReadonlyArray<CanvasItem>): CanvasItem[] {
    return [...items].sort((a, b) => {
        const aTime = Date.parse(a.updatedAt);
        const bTime = Date.parse(b.updatedAt);
        if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
            return bTime - aTime;
        }
        return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function snapshotFileName(canvasId: string): string {
    return `${encodeURIComponent(canvasId)}.snapshot.json`;
}

function getStorage(): FeatureStorage {
    if (!storage) {
        throw new Error("Canvas service not initialized. Call initializeCanvasService() first.");
    }
    return storage;
}

async function readIndex(): Promise<CanvasItem[]> {
    const raw = await getStorage().readFile(INDEX_FILE);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
            return z.array(CanvasItemSchema).parse(parsed);
        }
        const index = CanvasIndexSchema.parse(parsed);
        return index.items;
    } catch (error) {
        canvasLogger.warn("Failed to parse canvas index, treating as empty", {
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}

async function writeIndex(items: ReadonlyArray<CanvasItem>): Promise<void> {
    const index: CanvasIndex = {
        version: 1,
        items: sortByUpdatedAtDesc(items),
    };
    await getStorage().writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

function createCanvasId(existing: ReadonlySet<string>): string {
    let candidate = "";
    do {
        candidate = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } while (existing.has(candidate));
    return candidate;
}

function findCanvas(items: ReadonlyArray<CanvasItem>, canvasId: string): CanvasItem | null {
    const match = items.find((item) => item.id === canvasId);
    return match ?? null;
}

export async function initializeCanvasService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        canvasLogger.warn("No active workspace, skipping canvas initialization");
        return;
    }

    storage = new FeatureStorage(getCanvasesPath());
    await getStorage().initialize();
    canvasLogger.info("Canvas service initialized");
}

export async function listCanvases(): Promise<CanvasItem[]> {
    return sortByUpdatedAtDesc(await readIndex());
}

export async function getCanvas(input: { canvasId: string }): Promise<CanvasItem> {
    const items = await readIndex();
    const canvas = findCanvas(items, input.canvasId);
    if (!canvas) {
        throw new Error(`Canvas not found: ${input.canvasId}`);
    }
    return canvas;
}

export async function createCanvas(input: { title?: string }): Promise<CanvasItem> {
    const items = await readIndex();
    const existingIds = new Set(items.map((item) => item.id));
    const timestamp = nowIso();

    const nextCanvas: CanvasItem = {
        id: createCanvasId(existingIds),
        title: normalizeTitle(input.title),
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    await writeIndex([nextCanvas, ...items]);
    return nextCanvas;
}

export async function updateCanvas(input: {
    canvasId: string;
    updates: {
        title?: string;
    };
}): Promise<CanvasItem> {
    const items = await readIndex();
    let updatedCanvas: CanvasItem | null = null;

    const nextItems = items.map((item) => {
        if (item.id !== input.canvasId) return item;
        updatedCanvas = {
            ...item,
            title: normalizeTitle(input.updates.title ?? item.title),
            updatedAt: nowIso(),
        };
        return updatedCanvas;
    });

    if (!updatedCanvas) {
        throw new Error(`Canvas not found: ${input.canvasId}`);
    }

    await writeIndex(nextItems);
    return updatedCanvas;
}

export async function deleteCanvas(input: { canvasId: string }): Promise<{ success: boolean }> {
    const items = await readIndex();
    const nextItems = items.filter((item) => item.id !== input.canvasId);
    if (nextItems.length === items.length) {
        return { success: false };
    }

    await writeIndex(nextItems);

    try {
        await getStorage().deleteFile(snapshotFileName(input.canvasId));
    } catch {
        // Ignore missing snapshot files.
    }

    return { success: true };
}

export async function getCanvasSnapshot(input: {
    canvasId: string;
}): Promise<{ snapshot: string | null }> {
    const snapshot = await getStorage().readFile(snapshotFileName(input.canvasId));
    return { snapshot };
}

export async function saveCanvasSnapshot(input: {
    canvasId: string;
    snapshot: string;
}): Promise<{ success: boolean; updatedAt: string }> {
    const items = await readIndex();
    let updatedAt = nowIso();
    let found = false;

    const nextItems = items.map((item) => {
        if (item.id !== input.canvasId) return item;
        found = true;
        const nextItem = {
            ...item,
            updatedAt,
        };
        return nextItem;
    });

    if (!found) {
        throw new Error(`Canvas not found: ${input.canvasId}`);
    }

    await getStorage().writeFile(snapshotFileName(input.canvasId), input.snapshot);
    await writeIndex(nextItems);

    return { success: true, updatedAt };
}
