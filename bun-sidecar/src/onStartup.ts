import { createServiceLogger } from "./lib/logger";
import { getRootPath, getNoetectPath, getTodosPath, getNotesPath, getUploadsPath, getSkillsPath, hasActiveWorkspace } from "./storage/root-path";
import { mkdir } from "node:fs/promises";
import { initializeBacklinksService } from "./features/notes/backlinks-service";
import { initializeTagsService } from "./features/notes/tags-service";
import { initializeDefaultSkills } from "./services/default-skills";
import type { SkillUpdateCheckResult } from "./services/skills-types";

const startupLogger = createServiceLogger("STARTUP");

export async function onStartup(): Promise<SkillUpdateCheckResult | null> {
    startupLogger.info("=== Server Startup Sequence ===");
    startupLogger.info("Starting initialization...");

    // Add startup tasks here
    startupLogger.info("Checking environment...");
    startupLogger.info(`Node environment: ${process.env.NODE_ENV || "development"}`);
    startupLogger.info(`Bun version: ${Bun.version}`);
    startupLogger.info(`Platform: ${process.platform}`);
    startupLogger.info(`Working directory: ${process.cwd()}`);

    // Only create directories if we have an active workspace
    if (!hasActiveWorkspace()) {
        startupLogger.info("No active workspace configured - skipping directory creation");
        startupLogger.info("=== Startup Sequence Complete ===");
        return null;
    }

    // Ensure root directory and feature folders exist
    startupLogger.info("Ensuring directories exist...");
    try {
        const rootPath = getRootPath();
        await mkdir(rootPath, { recursive: true });
        startupLogger.info(`Root directory verified: ${rootPath}`);

        const todosPath = getTodosPath();
        await mkdir(todosPath, { recursive: true });
        startupLogger.info(`Todos directory verified: ${todosPath}`);

        const notesPath = getNotesPath();
        await mkdir(notesPath, { recursive: true });
        startupLogger.info(`Notes directory verified: ${notesPath}`);

        const uploadsPath = getUploadsPath();
        await mkdir(uploadsPath, { recursive: true });
        startupLogger.info(`Uploads directory verified: ${uploadsPath}`);

        const noetectPath = getNoetectPath();
        await mkdir(noetectPath, { recursive: true });
        startupLogger.info(`.noetect directory verified: ${noetectPath}`);

        const skillsPath = getSkillsPath();
        await mkdir(skillsPath, { recursive: true });
        startupLogger.info(`.claude/skills directory verified: ${skillsPath}`);

        // Create .gitignore if it doesn't exist
        const gitignorePath = `${rootPath}/.gitignore`;
        const gitignoreFile = Bun.file(gitignorePath);
        if (!(await gitignoreFile.exists())) {
            await Bun.write(gitignorePath, ".noetect/\n");
            startupLogger.info(`.gitignore created at: ${gitignorePath}`);
        } else {
            // Check if .noetect/ is already in .gitignore
            const content = await gitignoreFile.text();
            if (!content.includes(".noetect")) {
                await Bun.write(gitignorePath, content.trimEnd() + "\n.noetect/\n");
                startupLogger.info(`.noetect/ added to existing .gitignore`);
            }
        }
    } catch (error) {
        startupLogger.error("Failed to create directories", {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }

    // Initialize backlinks index
    startupLogger.info("Initializing backlinks index...");
    try {
        await initializeBacklinksService();
        startupLogger.info("Backlinks index initialized");
    } catch (error) {
        startupLogger.error("Failed to initialize backlinks index", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize tags index
    startupLogger.info("Initializing tags index...");
    try {
        await initializeTagsService();
        startupLogger.info("Tags index initialized");
    } catch (error) {
        startupLogger.error("Failed to initialize tags index", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize default skills
    startupLogger.info("Initializing default skills...");
    let skillUpdateResult: SkillUpdateCheckResult | null = null;
    try {
        skillUpdateResult = await initializeDefaultSkills();
        startupLogger.info("Default skills initialized");
    } catch (error) {
        startupLogger.error("Failed to initialize default skills", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    startupLogger.info("Initialization complete");
    startupLogger.info("=== Startup Sequence Complete ===");

    return skillUpdateResult;
}
