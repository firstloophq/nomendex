import {
    listCanvases,
    getCanvas,
    createCanvas,
    updateCanvas,
    deleteCanvas,
    getCanvasSnapshot,
    saveCanvasSnapshot,
    saveCRDTState,
    getCRDTState,
} from "@/features/canvas/fx";

export const canvasRoutes = {
    "/api/canvas/list": {
        async POST() {
            const result = await listCanvases();
            return Response.json(result);
        },
    },
    "/api/canvas/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getCanvas(args);
            return Response.json(result);
        },
    },
    "/api/canvas/create": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await createCanvas(args);
            return Response.json(result);
        },
    },
    "/api/canvas/update": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await updateCanvas(args);
            return Response.json(result);
        },
    },
    "/api/canvas/delete": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await deleteCanvas(args);
            return Response.json(result);
        },
    },
    "/api/canvas/snapshot/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getCanvasSnapshot(args);
            return Response.json(result);
        },
    },
    "/api/canvas/snapshot/save": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await saveCanvasSnapshot(args);
            return Response.json(result);
        },
    },
    "/api/canvas/crdt-state/save": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await saveCRDTState(args);
            return Response.json(result);
        },
    },
    "/api/canvas/crdt-state/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getCRDTState(args);
            return Response.json(result);
        },
    },
};
