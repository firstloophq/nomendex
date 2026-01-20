import type { RouteHandler } from "../types/Routes";
import { shouldSuppressWarnings } from "../config/env";

interface EnvConfigResponse {
    suppressWarnings: boolean;
}

export const envRoutes: Record<string, RouteHandler<EnvConfigResponse>> = {
    "/api/env/config": {
        GET: async () => {
            return Response.json({
                suppressWarnings: shouldSuppressWarnings(),
            });
        },
    },
};
