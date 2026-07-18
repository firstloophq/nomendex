import { z } from "zod";
import type { ComponentType } from "react";
import { FunctionsSchema, FunctionStubsSchema } from "./Functions";
import type { FunctionStubs, FunctionsFromStubs } from "./Functions";
import { CommandSchema } from "./Commands";

export const PluginIconSchema = z.enum(["file", "workflow", "bot-message-square", "list-todo", "mic", "semicolon", "image", "hash"]);

export const PluginViewDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    component: z.any(),
});

export const PermissionsSchema = z.array(
    z.object({
        tool: z.string(),
        status: z.enum(["approved", "disapproved"]),
    })
);

export const PluginBaseSchema = z.object({
    id: z.string(),
    name: z.string(),
    icon: PluginIconSchema,
    views: z.record(z.string(), PluginViewDefinitionSchema),
    functionStubs: FunctionStubsSchema,
    commands: z.array(CommandSchema),
});

export const PluginsWithFunctionsSchema = PluginBaseSchema.extend({
    functions: FunctionsSchema,
});

// Simplified plugin info for serialization (without functions/views)
export const SerializablePluginSchema = z.object({
    id: z.string(),
    name: z.string(),
    icon: PluginIconSchema,
});
export type SerializablePlugin = z.infer<typeof SerializablePluginSchema>;

export const PluginInstanceSchema = z.object({
    instanceId: z.string(),
    plugin: SerializablePluginSchema, // Use serializable version for workspace
    viewId: z.string(),
    instanceProps: z.record(z.string(), z.any()).optional(),
});

export type PluginIcon = z.infer<typeof PluginIconSchema>;

export type PluginViewDefinition = {
    id: string;
    name: string;
    component: ComponentType;
};
export type PluginBase = z.infer<typeof PluginBaseSchema>;
export type PluginWithFunctions = z.infer<typeof PluginsWithFunctionsSchema>;
export type PluginInstance = z.infer<typeof PluginInstanceSchema>;

// Generic, fully-typed plugin-with-functions type that preserves fx signatures
export type TypedPluginWithFunctions<Stubs extends FunctionStubs> = PluginBase & {
    functions: FunctionsFromStubs<Stubs>;
};
