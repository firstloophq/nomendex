import { z } from "zod";

/**
 * Kanban board column.
 */
export const BoardColumnSchema = z.object({
    id: z.string(),
    title: z.string(),
    order: z.number(),
    status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

/**
 * Board configuration for a project.
 */
export const BoardConfigSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    columns: z.array(BoardColumnSchema),
    showDone: z.boolean().default(true),
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;

/**
 * Default columns for a new board.
 */
export function getDefaultColumns(): BoardColumn[] {
    return [
        { id: "col-backlog", title: "Backlog", order: 1, status: "todo" },
        { id: "col-this-week", title: "This Week", order: 2, status: "in_progress" },
        { id: "col-today", title: "Today", order: 3, status: "in_progress" },
        { id: "col-done", title: "Done", order: 4, status: "done" },
    ];
}
