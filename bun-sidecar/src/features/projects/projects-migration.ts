import { getProjectsFilePath, saveProject } from "./projects-service";
import { getProjects } from "@/features/todos/fx";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("PROJECTS-MIGRATION");

export async function migrateProjects() {
    const projectsFile = Bun.file(getProjectsFilePath());
    if (await projectsFile.exists()) {
        logger.info("projects.json already exists, skipping migration");
        return;
    }

    logger.info("Starting project migration from todos...");

    try {
        const projectNames = await getProjects();

        logger.info(`Found ${projectNames.length} unique projects to migrate`);

        for (const name of projectNames) {
            if (!name) continue;

            await saveProject({
                id: `proj-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                name: name,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }

        logger.info("Project migration complete");
    } catch (error) {
        logger.error("Failed to migrate projects", { error: error instanceof Error ? error.message : String(error) });
    }
}
