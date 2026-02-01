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
        { id: "col-todo", title: "To Do", order: 1, status: "todo" },
        { id: "col-in_progress", title: "In Progress", order: 2, status: "in_progress" },
        { id: "col-done", title: "Done", order: 3, status: "done" },
        { id: "col-later", title: "Later", order: 4, status: "later" },
    ];
}
