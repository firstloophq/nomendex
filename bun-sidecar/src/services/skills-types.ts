import { z } from "zod";

/**
 * Schema for skill metadata parsed from SKILL.md frontmatter
 */
export const SkillMetadataSchema = z.object({
    name: z.string(),
    description: z.string(),
    version: z.number().int().positive(),
});

export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

/**
 * Information about an available skill update
 */
export interface SkillUpdateInfo {
    skillName: string;
    currentVersion: number | null; // null if skill doesn't exist
    availableVersion: number;
}

/**
 * Result of checking for skill updates
 */
export interface SkillUpdateCheckResult {
    pendingUpdates: SkillUpdateInfo[];
    newSkills: string[]; // Skills that don't exist yet
}
