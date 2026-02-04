import { z } from "zod";

export const CaptureDestinationSchema = z.enum(["folder", "daily"]);
export type CaptureDestination = z.infer<typeof CaptureDestinationSchema>;

export const CaptureSettingsSchema = z.object({
    destination: CaptureDestinationSchema.default("folder"),
    captureFolder: z.string().default("Captures"),
});

export type CaptureSettings = z.infer<typeof CaptureSettingsSchema>;

export const CreateCaptureInputSchema = z.object({
    content: z.string(),
    title: z.string().optional(),
});

export type CreateCaptureInput = z.infer<typeof CreateCaptureInputSchema>;

export const CreateCaptureOutputSchema = z.object({
    fileName: z.string(),
    content: z.string(),
});

export type CreateCaptureOutput = z.infer<typeof CreateCaptureOutputSchema>;
