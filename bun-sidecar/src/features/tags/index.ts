import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import TagsBrowserView from "./tags-browser-view";
import TagDetailView from "./tag-detail-view";

export const TagSuggestionSchema = z.object({
    tag: z.string(),
    count: z.number(),
});

export type TagSuggestion = z.infer<typeof TagSuggestionSchema>;

export const TagFileReferenceSchema = z.object({
    fileRef: z.string(), // "notes:path.md" or "todos:path.md"
    source: z.enum(["notes", "todos"]),
    path: z.string(),
    title: z.string().optional(),
    preview: z.string().optional(),
});

export type TagFileReference = z.infer<typeof TagFileReferenceSchema>;

export const tagDetailViewPropsSchema = z.object({
    tagName: z.string(),
});
export type TagDetailViewProps = z.infer<typeof tagDetailViewPropsSchema>;

const views = {
    default: {
        id: "default",
        name: "Tags Browser",
        component: TagsBrowserView,
    },
    browser: {
        id: "browser",
        name: "Tags Browser",
        component: TagsBrowserView,
    },
    detail: {
        id: "detail",
        name: "Tag Detail",
        component: TagDetailView,
        props: tagDetailViewPropsSchema,
    },
} as const;

export const tagsPluginSerial: SerializablePlugin = {
    id: "tags",
    name: "Tags",
    icon: "hash",
};

export const TagsPluginBase: PluginBase = {
    id: tagsPluginSerial.id,
    name: tagsPluginSerial.name,
    icon: tagsPluginSerial.icon,
    views,
    functionStubs: {},
    commands: [],
};
