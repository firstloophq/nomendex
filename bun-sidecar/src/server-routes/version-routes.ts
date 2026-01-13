import { RouteHandler } from "../types/Routes";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

interface VersionResponse {
    version: string;
    buildNumber: string;
}

// Find Info.plist relative to the running binary
async function getVersionFromInfoPlist(): Promise<VersionResponse> {
    const execPath = process.execPath;

    // When running as bundled app: .app/Contents/Resources/sidecar/sidecar
    // Info.plist is at: .app/Contents/Info.plist
    // So go up 3 levels from sidecar binary, then into Contents/Info.plist
    const possiblePaths = [
        // Bundled app path
        join(dirname(execPath), "..", "..", "Info.plist"),
        // Dev mode - relative to project
        join(process.cwd(), "mac-app", "macos-host", "Info.plist"),
        // Another dev possibility
        join(dirname(execPath), "..", "..", "..", "mac-app", "macos-host", "Info.plist"),
    ];

    for (const plistPath of possiblePaths) {
        try {
            const content = await readFile(plistPath, "utf-8");

            // Simple XML parsing for the version strings
            const versionMatch = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
            const buildMatch = content.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);

            if (versionMatch) {
                return {
                    version: versionMatch[1],
                    buildNumber: buildMatch?.[1] ?? "0"
                };
            }
        } catch {
            // Try next path
            continue;
        }
    }

    // Fallback
    return { version: "dev", buildNumber: "0" };
}

export const versionRoutes = {
    "/api/version": {
        GET: async () => {
            const versionInfo = await getVersionFromInfoPlist();
            return Response.json(versionInfo);
        }
    } satisfies RouteHandler<VersionResponse>
};
