import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import UploadsBrowserView from "./browser-view";
import { FunctionStubs } from "@/types/Functions";

export const UploadSchema = z.object({
    id: z.string(),
    filename: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    size: z.number(),
    url: z.string(),
    createdAt: z.string(),
});

export type Upload = z.infer<typeof UploadSchema>;

export const functionStubs = {
    getUploads: {
        input: z.object({}),
        output: z.array(UploadSchema),
    },
    deleteUpload: {
        input: z.object({ filename: z.string() }),
        output: z.object({ success: z.boolean() }),
    },
} satisfies FunctionStubs;

const views = {
    default: {
        id: "default",
        name: "File Browser",
        component: UploadsBrowserView,
    },
    browser: {
        id: "browser",
        name: "File Browser",
        component: UploadsBrowserView,
    },
} as const;

export const uploadsPluginSerial: SerializablePlugin = {
    id: "uploads",
    name: "Media",
    icon: "image",
};

export const UploadsPluginBase: PluginBase = {
    id: uploadsPluginSerial.id,
    name: uploadsPluginSerial.name,
    icon: uploadsPluginSerial.icon,
    views,
    functionStubs: functionStubs,
    commands: [],
};
