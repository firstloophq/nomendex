import type { CanvasItem } from "@/features/canvas";

async function fetchAPI<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`/api/canvas/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

export const canvasAPI = {
    listCanvases: () => fetchAPI<CanvasItem[]>("list"),
    getCanvas: (args: { canvasId: string }) => fetchAPI<CanvasItem>("get", args),
    createCanvas: (args: { title?: string }) => fetchAPI<CanvasItem>("create", args),
    updateCanvas: (args: { canvasId: string; updates: { title?: string } }) => fetchAPI<CanvasItem>("update", args),
    deleteCanvas: (args: { canvasId: string }) => fetchAPI<{ success: boolean }>("delete", args),
    getSnapshot: (args: { canvasId: string }) => fetchAPI<{ snapshot: string | null }>("snapshot/get", args),
    saveSnapshot: (args: { canvasId: string; snapshot: string }) =>
        fetchAPI<{ success: boolean; updatedAt: string }>("snapshot/save", args),
    saveCRDTState: (args: { canvasId: string; crdtState: string }) =>
        fetchAPI<{ success: boolean }>("crdt-state/save", args),
    getCRDTState: (args: { canvasId: string }) =>
        fetchAPI<{ crdtState: string | null }>("crdt-state/get", args),
};

export function useCanvasAPI() {
    return canvasAPI;
}
