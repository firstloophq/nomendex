import { z } from "zod";

// Kanban board column
export const BoardColumnSchema = z.object({
    id: z.string(),                    // "col-backlog"
    title: z.string(),                 // "Backlog"
    order: z.number(),                 // 1, 2, 3...
    status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

// Board configuration
export const BoardConfigSchema = z.object({
    columns: z.array(BoardColumnSchema),
    showDone: z.boolean().default(true),
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;

// Project
export const ProjectConfigSchema = z.object({
    id: z.string(),                    // "proj-abc123"
    name: z.string(),                  // "Nomendex"
    description: z.string().optional(),
    board: BoardConfigSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// Entire projects.json file
export const ProjectsFileSchema = z.object({
    version: z.literal(1),
    projects: z.array(ProjectConfigSchema),
});
export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;
