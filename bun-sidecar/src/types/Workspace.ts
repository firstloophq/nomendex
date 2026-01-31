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
    paused: z.boolean().default(false),
});
export type AutoSyncConfig = z.infer<typeof AutoSyncConfigSchema>;

// Pane schema for split layout
export const PaneSchema = z.object({
    id: z.string(),
    tabs: z.array(WorkspaceTabSchema),
    activeTabId: z.string().nullable(),
});
export type Pane = z.infer<typeof PaneSchema>;

export const LayoutModeSchema = z.enum(["single", "split"]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const WorkspaceStateSchema = z.object({
    // Legacy tab fields (kept for backwards compatibility, used in single-pane mode)
    tabs: z.array(WorkspaceTabSchema),
    activeTabId: z.string().nullable(),
    sidebarOpen: z.boolean().default(false),
    sidebarTabId: z.string().nullable(),

    // New pane-based structure for split layout
    panes: z.array(PaneSchema).default([]),
    activePaneId: z.string().nullable().default(null),
    splitRatio: z.number().min(0.2).max(0.8).default(0.5),
    layoutMode: LayoutModeSchema.default("single"),

    // Other settings
    mcpServerConfigs: z.array(McpServerStatusSchema).default([]),
    projectPreferences: z.record(z.string(), ProjectPreferencesSchema).default({}),
    gitAuthMode: GitAuthModeSchema.default("local"),
    notesLocation: NotesLocationSchema.default("root"),
    autoSync: AutoSyncConfigSchema.default({ enabled: true, syncOnChanges: true, intervalSeconds: 60, paused: false }),
    chatInputEnterToSend: z.boolean().default(true),
    showHiddenFiles: z.boolean().default(false),
});

export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;
export type ProjectPreferences = z.infer<typeof ProjectPreferencesSchema>;
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
