import { z } from "zod";

export const FileLockSchema = z.object({
    noteFileName: z.string(),
    agentId: z.string(),
    agentName: z.string(),
    lockedAt: z.number(),
});

export type FileLock = z.infer<typeof FileLockSchema>;
