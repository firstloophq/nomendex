import { z } from "zod";

/**
 * Sloupec na Kanban boardu.
 * - id: unikátní identifikátor sloupce
 * - title: zobrazovaný název (např. "Tento týden")
 * - order: pořadí zleva doprava (1, 2, 3...)
 * - status: volitelný status, který se nastaví při přetažení todo do sloupce
 */
export const BoardColumnSchema = z.object({
    id: z.string(),
    title: z.string(),
    order: z.number(),
    status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

/**
 * Konfigurace boardu pro jeden projekt.
 * - id: unikátní ID konfigurace (FileDatabase vyžaduje)
 * - projectId: název projektu (prázdný string = todos bez projektu)
 * - columns: seznam sloupců
 * - showDone: zda zobrazovat dokončené úkoly
 */
export const BoardConfigSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    columns: z.array(BoardColumnSchema),
    showDone: z.boolean().default(true),
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;

/**
 * Výchozí sloupce pro nový board.
 * Použij tuto funkci když projekt nemá uloženou konfiguraci.
 */
export function getDefaultColumns(): BoardColumn[] {
    return [
        { id: "col-backlog", title: "Backlog", order: 1, status: "todo" },
        { id: "col-this-week", title: "This Week", order: 2, status: "in_progress" },
        { id: "col-today", title: "Today", order: 3, status: "in_progress" },
        { id: "col-done", title: "Done", order: 4, status: "done" },
    ];
}
