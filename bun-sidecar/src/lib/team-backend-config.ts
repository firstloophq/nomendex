const DEFAULT_TEAM_BACKEND_HTTP_URL = "http://localhost:4444";

interface TeamBackendConfigResponse {
    success?: boolean;
    data?: {
        httpUrl?: string;
    };
}

let cachedHttpUrl: string | null = null;

function normalizeHttpUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

/**
 * Runtime-resolved team-backend URL from bun-sidecar config.
 * Falls back to localhost for local development.
 */
export async function getTeamBackendHttpUrl(): Promise<string> {
    if (cachedHttpUrl) {
        return cachedHttpUrl;
    }

    try {
        const response = await fetch("/api/team-backend/config");
        if (response.ok) {
            const payload = (await response.json()) as TeamBackendConfigResponse;
            const httpUrl = payload.data?.httpUrl;
            if (typeof httpUrl === "string" && httpUrl.trim().length > 0) {
                cachedHttpUrl = normalizeHttpUrl(httpUrl.trim());
                return cachedHttpUrl;
            }
        }
    } catch {
        // Use default fallback when local config endpoint isn't available.
    }

    cachedHttpUrl = DEFAULT_TEAM_BACKEND_HTTP_URL;
    return cachedHttpUrl;
}
