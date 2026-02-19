import { RouteHandler } from "../types/Routes";
import { getLogFile } from "@/lib/logger";

interface LogsResponse {
    success: boolean;
    path?: string;
    lines?: string[];
    count?: number;
}

export const logsRoutes = {
    "/api/logs/reset": {
        POST: async () => {
            try {
                const logFile = getLogFile();
                await Bun.write(logFile, "");
                return Response.json({ success: true, path: logFile });
            } catch (error) {
                console.error("Failed to reset logs:", error);
                return Response.json({ success: false }, { status: 500 });
            }
        },
    } satisfies RouteHandler<LogsResponse>,

    "/api/logs/reveal": {
        POST: async () => {
            try {
                const logFile = getLogFile();
                Bun.spawn(["open", "-R", logFile]);
                return Response.json({ success: true, path: logFile });
            } catch (error) {
                console.error("Failed to reveal logs:", error);
                return Response.json({ success: false }, { status: 500 });
            }
        },
    } satisfies RouteHandler<LogsResponse>,

    "/api/logs/path": {
        GET: async () => {
            const logFile = getLogFile();
            return Response.json({ success: true, path: logFile });
        },
    } satisfies RouteHandler<LogsResponse>,

    "/api/logs/recent": {
        GET: async (req: Request) => {
            try {
                const url = new URL(req.url);
                const rawLimit = Number(url.searchParams.get("limit") ?? "200");
                const limit = Number.isFinite(rawLimit)
                    ? Math.max(1, Math.min(2000, Math.floor(rawLimit)))
                    : 200;
                const contains = url.searchParams.get("contains") ?? "";

                const logFile = getLogFile();
                const file = Bun.file(logFile);
                if (!(await file.exists())) {
                    return Response.json({ success: true, path: logFile, lines: [], count: 0 });
                }

                const text = await file.text();
                let lines = text
                    .split("\n")
                    .map((line) => line.trimEnd())
                    .filter((line) => line.length > 0);

                if (contains.length > 0) {
                    lines = lines.filter((line) => line.includes(contains));
                }

                const recent = lines.slice(-limit);
                return Response.json({
                    success: true,
                    path: logFile,
                    lines: recent,
                    count: recent.length,
                });
            } catch (error) {
                console.error("Failed to read recent logs:", error);
                return Response.json({ success: false }, { status: 500 });
            }
        },
    } satisfies RouteHandler<LogsResponse>,
};
