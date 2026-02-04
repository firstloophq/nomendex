import { createTextCapture, getCaptureSettings, saveCaptureSettings } from "@/features/captures/fx";

export const capturesRoutes = {
    "/api/captures/create": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await createTextCapture(args);
            return Response.json(result);
        },
    },
    "/api/captures/settings": {
        async GET() {
            const settings = await getCaptureSettings();
            return Response.json(settings);
        },
        async POST(req: Request) {
            const args = await req.json();
            const result = await saveCaptureSettings({ settings: args });
            return Response.json(result);
        },
    },
};
