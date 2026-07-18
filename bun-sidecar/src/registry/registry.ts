import { NotesPluginBase } from "@/features/notes";
import { PluginBase } from "@/types/Plugin";
import { TodosPluginBase } from "@/features/todos";
import { UploadsPluginBase } from "@/features/uploads";
import { TagsPluginBase } from "@/features/tags";

// Registry of built-in features (simplified from plugin system)
export const baseRegistry = {
    notes: NotesPluginBase,
    todos: TodosPluginBase,
    uploads: UploadsPluginBase,
    tags: TagsPluginBase,
} as const;

export type BaseRegistryPlugins = typeof baseRegistry;
export type PluginId = keyof BaseRegistryPlugins;

export function getPlugin<T extends PluginId>(id: T): BaseRegistryPlugins[T];
export function getPlugin(id: string): PluginBase | undefined;
export function getPlugin(id: string) {
    return baseRegistry[id as keyof typeof baseRegistry];
}
