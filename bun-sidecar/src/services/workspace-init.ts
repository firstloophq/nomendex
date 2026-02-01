import { startupLog } from "@/lib/logger";
import { initializePaths, hasActiveWorkspace, getActiveWorkspacePath } from "@/storage/root-path";
import { initializeTodosService } from "@/features/todos/fx";
import { initializeNotesService } from "@/features/notes/fx";
import { initializeProjectsService } from "@/features/projects/fx";
import { secrets } from "@/lib/secrets";
import { onStartup } from "@/onStartup";

/**
 * Initialize or reinitialize all workspace-dependent services.
 * Called at server startup and when switching workspaces.
 */
export async function initializeWorkspaceServices(): Promise<void> {
    // Reinitialize paths from global config
    startupLog.info("Loading workspace configuration...");
    try {
        await initializePaths();
        const workspacePath = getActiveWorkspacePath();
        if (workspacePath) {
            startupLog.info("Active workspace found", { path: workspacePath });
        } else {
            startupLog.info("No active workspace configured");
        }
    } catch (error) {
        startupLog.error("Failed to initialize paths", {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }

    // Load secrets into process.env
    startupLog.info("Loading secrets...");
    try {
        await secrets.loadIntoProcessEnv();
        startupLog.info("Secrets loaded");
    } catch (error) {
        startupLog.error("Failed to load secrets", {
            error: error instanceof Error ? error.message : String(error)
        });
        // Don't throw - secrets may not exist yet
    }

    // Run startup sequence (creates workspace directories if active)
    startupLog.info("Running startup sequence...");
    try {
        await onStartup();
        startupLog.info("Startup sequence complete");
    } catch (error) {
        startupLog.error("Startup sequence failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }

    // Initialize feature services (only if workspace is active)
    if (hasActiveWorkspace()) {
        startupLog.info("Initializing feature services...");
        try {
            await initializeTodosService();
            await initializeNotesService();
            await initializeProjectsService();
            startupLog.info("Feature services initialized");
        } catch (error) {
            startupLog.error("Failed to initialize feature services", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    } else {
        startupLog.info("Skipping feature services (no active workspace)");
    }
}
