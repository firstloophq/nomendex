import { z } from "zod";

export const ViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    html: z.string(),
    title: z.string().optional(),
    height: z.number().optional(),
    allowSameOrigin: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type ViewDefinition = z.infer<typeof ViewSchema>;
