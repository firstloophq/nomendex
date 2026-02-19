import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import { CanvasBrowserView } from "./browser-view";
import { CanvasEditorView } from "./editor-view";

export const CanvasItemSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type CanvasItem = z.infer<typeof CanvasItemSchema>;

export const canvasEditorViewPropsSchema = z.object({
    canvasId: z.string().min(1),
});
export type CanvasEditorViewProps = z.infer<typeof canvasEditorViewPropsSchema>;

const views = {
    default: {
        id: "default",
        name: "Canvas Browser",
        component: CanvasBrowserView,
    },
    browser: {
        id: "browser",
        name: "Canvas Browser",
        component: CanvasBrowserView,
    },
    editor: {
        id: "editor",
        name: "Canvas Editor",
        component: CanvasEditorView,
        props: canvasEditorViewPropsSchema,
    },
} as const;

export const canvasPluginSerial: SerializablePlugin = {
    id: "canvas",
    name: "Canvas",
    icon: "image",
};

export const CanvasPluginBase: PluginBase = {
    id: canvasPluginSerial.id,
    name: canvasPluginSerial.name,
    icon: canvasPluginSerial.icon,
    mcpServers: {},
    views,
    functionStubs: {},
    commands: [],
};
