import { z } from "zod";
import { AttachmentSchema } from "@/types/attachments";

export const TodoSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(["todo", "in_progress", "done", "later"]),
    customColumnId: z.string().optional(), // ID sloupce z BoardConfig
    createdAt: z.string(),
    updatedAt: z.string(),
    archived: z.boolean().optional(),
    project: z.string().optional(),
    order: z.number().optional(),
    tags: z.array(z.string()).optional(),
    dueDate: z.string().optional(),
    attachments: z.array(AttachmentSchema).optional(),
});

export type Todo = z.infer<typeof TodoSchema>;
