import { z } from "zod";

export const ProjectConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    archived: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const ProjectsFileSchema = z.object({
    version: z.number(),
    projects: z.array(ProjectConfigSchema),
    migratedAt: z.string().optional(),
});

export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;
