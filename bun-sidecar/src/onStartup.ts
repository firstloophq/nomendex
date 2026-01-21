import { startupLog } from "./lib/logger";
import { getRootPath, getNomendexPath, getTodosPath, getNotesPath, getUploadsPath, getSkillsPath, hasActiveWorkspace, getActiveWorkspacePath } from "./storage/root-path";
import { mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { initializeBacklinksService } from "./features/notes/backlinks-service";
import { initializeTagsService } from "./features/notes/tags-service";
import { initializeDefaultSkills } from "./services/default-skills";
import type { SkillUpdateCheckResult } from "./services/skills-types";

/**
 * Safely create a directory with error logging.
 * Returns true if successful, false if failed.
 */
async function ensureDirectory(params: { path: string; label: string }): Promise<boolean> {
    const { path, label } = params;
    try {
        await mkdir(path, { recursive: true });
        startupLog.info(`${label} directory verified: ${path}`);
        return true;
    } catch (error) {
        startupLog.error(`Failed to create ${label} directory`, {
            path,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

export async function onStartup(): Promise<SkillUpdateCheckResult | null> {
    startupLog.info("=== Server Startup Sequence ===");
    startupLog.info("Starting initialization...");

    // Add startup tasks here
    startupLog.info("Checking environment...");
    startupLog.info(`Node environment: ${process.env.NODE_ENV || "development"}`);
    startupLog.info(`Bun version: ${Bun.version}`);
    startupLog.info(`Platform: ${process.platform}`);
    startupLog.info(`Working directory: ${process.cwd()}`);

    // Only create directories if we have an active workspace
    if (!hasActiveWorkspace()) {
        startupLog.info("No active workspace configured - skipping directory creation");
        startupLog.info("=== Startup Sequence Complete ===");
        return null;
    }

    const workspacePath = getActiveWorkspacePath();
    startupLog.info(`Active workspace path: ${workspacePath}`);

    // Validate workspace path exists and is accessible
    startupLog.info("Validating workspace path...");
    try {
        await access(workspacePath!, constants.R_OK | constants.W_OK);
        startupLog.info("Workspace path is accessible");
    } catch (error) {
        startupLog.error("Workspace path is not accessible", {
            path: workspacePath,
            error: error instanceof Error ? error.message : String(error),
        });
        startupLog.error("Startup cannot continue - workspace path invalid or inaccessible");
        startupLog.info("=== Startup Sequence Failed ===");
        throw new Error(`Workspace path not accessible: ${workspacePath}`);
    }

    // Ensure root directory and feature folders exist (with granular error handling)
    startupLog.info("Ensuring directories exist...");

    const rootPath = getRootPath();
    const rootOk = await ensureDirectory({ path: rootPath, label: "Root" });
    if (!rootOk) {
        startupLog.error("Cannot continue without root directory");
        throw new Error(`Failed to create root directory: ${rootPath}`);
    }

    const todosOk = await ensureDirectory({ path: getTodosPath(), label: "Todos" });
    const notesOk = await ensureDirectory({ path: getNotesPath(), label: "Notes" });
    const uploadsOk = await ensureDirectory({ path: getUploadsPath(), label: "Uploads" });
    const nomendexOk = await ensureDirectory({ path: getNomendexPath(), label: ".nomendex" });
    const skillsOk = await ensureDirectory({ path: getSkillsPath(), label: ".claude/skills" });

    // Log summary of directory creation
    const allDirsOk = todosOk && notesOk && uploadsOk && nomendexOk && skillsOk;
    if (!allDirsOk) {
        startupLog.warn("Some directories failed to create - app may have reduced functionality");
    }

    // Create .gitignore if it doesn't exist
    try {
        const gitignorePath = `${rootPath}/.gitignore`;
        const gitignoreFile = Bun.file(gitignorePath);
        if (!(await gitignoreFile.exists())) {
            await Bun.write(gitignorePath, ".nomendex/\n");
            startupLog.info(`.gitignore created at: ${gitignorePath}`);
        } else {
            // Check if .nomendex/ is already in .gitignore
            const content = await gitignoreFile.text();
            if (!content.includes(".nomendex")) {
                await Bun.write(gitignorePath, content.trimEnd() + "\n.nomendex/\n");
                startupLog.info(`.nomendex/ added to existing .gitignore`);
            }
        }
    } catch (error) {
        startupLog.warn("Failed to create/update .gitignore", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize backlinks index
    startupLog.info("Initializing backlinks index...");
    try {
        await initializeBacklinksService();
        startupLog.info("Backlinks index initialized");
    } catch (error) {
        startupLog.error("Failed to initialize backlinks index", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize tags index
    startupLog.info("Initializing tags index...");
    try {
        await initializeTagsService();
        startupLog.info("Tags index initialized");
    } catch (error) {
        startupLog.error("Failed to initialize tags index", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize default skills
    startupLog.info("Initializing default skills...");
    let skillUpdateResult: SkillUpdateCheckResult | null = null;
    try {
        skillUpdateResult = await initializeDefaultSkills();
        startupLog.info("Default skills initialized");
    } catch (error) {
        startupLog.error("Failed to initialize default skills", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    startupLog.info("Initialization complete");
    startupLog.info("=== Startup Sequence Complete ===");

    return skillUpdateResult;
}
