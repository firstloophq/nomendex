import { z } from "zod";
import { PluginInstanceSchema } from "./Plugin";

export const WorkspaceTabSchema = z.object({
    id: z.string(),
    title: z.string(),
    pluginInstance: PluginInstanceSchema,
});

export const McpServerStatusSchema = z.object({
    serverId: z.string(),
    enabled: z.boolean(),
});

export const ProjectPreferencesSchema = z.object({
    hideLaterColumn: z.boolean().default(false),
});

export const GitAuthModeSchema = z.enum(["pat", "local"]);
export type GitAuthMode = z.infer<typeof GitAuthModeSchema>;

export const NotesLocationSchema = z.enum(["root", "subfolder"]);
export type NotesLocation = z.infer<typeof NotesLocationSchema>;

export const AutoSyncConfigSchema = z.object({
    enabled: z.boolean().default(true),
    syncOnChanges: z.boolean().default(true),
    intervalSeconds: z.number().default(60),
});
export type AutoSyncConfig = z.infer<typeof AutoSyncConfigSchema>;

export const WorkspaceStateSchema = z.object({
    tabs: z.array(WorkspaceTabSchema),
    activeTabId: z.string().nullable(),
    sidebarOpen: z.boolean().default(false),
    sidebarTabId: z.string().nullable(),
    mcpServerConfigs: z.array(McpServerStatusSchema).default([]),
    projectPreferences: z.record(z.string(), ProjectPreferencesSchema).default({}),
    gitAuthMode: GitAuthModeSchema.default("local"),
    notesLocation: NotesLocationSchema.default("root"),
    autoSync: AutoSyncConfigSchema.default({ enabled: true, syncOnChanges: true, intervalSeconds: 60 }),
});

export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;
export type ProjectPreferences = z.infer<typeof ProjectPreferencesSchema>;
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
