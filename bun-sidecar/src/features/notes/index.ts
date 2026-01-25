import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import NotesView from "./note-view";
import NotesBrowserView from "./browser-view";
import CreateNoteView from "./create-view";
import { FunctionStubs } from "@/types/Functions";
export { getNotesCommands } from "./commands";

export const NoteSchema = z.object({
    fileName: z.string(),
    content: z.string(),
    frontMatter: z.record(z.string(), z.unknown()).optional(),
    folderPath: z.string().optional(), // Relative folder path (e.g., "projects/work")
    mtime: z.number().optional(), // File modification time in milliseconds (for freshness checking)
});

export type Note = z.infer<typeof NoteSchema>;

export const NoteFolderSchema = z.object({
    name: z.string(),
    path: z.string(), // Full relative path from notes root
});

export type NoteFolder = z.infer<typeof NoteFolderSchema>;

export const SearchResultSchema = z.object({
    fileName: z.string(),
    content: z.string(),
    frontMatter: z.record(z.string(), z.unknown()).optional(),
    folderPath: z.string().optional(),
    matches: z.array(z.object({
        line: z.number(),
        text: z.string(),
        startIndex: z.number(),
        endIndex: z.number(),
    })),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

export const functionStubs = {
    getNotes: {
        input: z.object({}),
        output: z.array(NoteSchema),
    },
    searchNotes: {
        input: z.object({ query: z.string() }),
        output: z.array(SearchResultSchema),
    },
    getNoteByFileName: {
        input: z.object({ fileName: z.string() }),
        output: NoteSchema,
    },
    createNote: {
        input: z.object({ fileName: z.string() }),
        output: NoteSchema,
    },
    saveNote: {
        input: z.object({
            fileName: z.string(),
            content: z.string(),
        }),
        output: NoteSchema,
    },
    updateNoteTags: {
        input: z.object({
            fileName: z.string(),
            tags: z.array(z.string()),
        }),
        output: NoteSchema,
    },
    deleteNote: {
        input: z.object({ fileName: z.string() }),
        output: z.object({ success: z.boolean() }),
    },
    renameNote: {
        input: z.object({
            oldFileName: z.string(),
            newFileName: z.string(),
        }),
        output: NoteSchema,
    },
    getDailyNoteName: {
        input: z.object({}),
        output: z.object({ fileName: z.string() }),
    },
    getRecentDailyNotes: {
        input: z.object({ days: z.number().optional() }),
        output: z.array(
            z.object({
                date: z.string(),
                fileName: z.string(),
                exists: z.boolean(),
                content: z.string().optional(),
                frontMatter: z.record(z.string(), z.unknown()).optional(),
            })
        ),
    },
    // Folder operations
    getFolders: {
        input: z.object({}),
        output: z.array(NoteFolderSchema),
    },
    createFolder: {
        input: z.object({
            name: z.string(),
            parentPath: z.string().optional(), // Parent folder path, empty = root
        }),
        output: NoteFolderSchema,
    },
    deleteFolder: {
        input: z.object({
            folderPath: z.string(),
        }),
        output: z.object({ success: z.boolean() }),
    },
    renameFolder: {
        input: z.object({
            oldPath: z.string(),
            newName: z.string(),
        }),
        output: NoteFolderSchema,
    },
    moveNoteToFolder: {
        input: z.object({
            fileName: z.string(),
            targetFolder: z.string().nullable(), // null = root
        }),
        output: NoteSchema,
    },
    updateNoteProject: {
        input: z.object({
            fileName: z.string(),
            project: z.string().nullable(), // null = remove project
        }),
        output: NoteSchema,
    },
    getNotesByProject: {
        input: z.object({ project: z.string() }),
        output: z.array(NoteSchema),
    },
    getNoteMtime: {
        input: z.object({ fileName: z.string() }),
        output: z.object({ mtime: z.number().nullable() }), // null if file doesn't exist
    },
    revealInFinder: {
        input: z.object({ fileName: z.string() }),
        output: z.object({ success: z.boolean() }),
    },
} satisfies FunctionStubs;
export const notesViewPropsSchema = z.object({
    noteFileName: z.string(),
    scrollToLine: z.number().optional(),
});
export type NotesViewProps = z.infer<typeof notesViewPropsSchema>;

const views = {
    default: {
        id: "default",
        name: "File Browser",
        component: NotesBrowserView,
    },
    browser: {
        id: "browser",
        name: "File Browser",
        component: NotesBrowserView,
    },
    create: {
        id: "create",
        name: "Create Note",
        component: CreateNoteView,
    },
    editor: {
        id: "editor",
        name: "Note Editor",
        component: NotesView,
        props: notesViewPropsSchema,
    },
} as const;
export const notesPluginSerial: SerializablePlugin = {
    id: "notes",
    name: "Notes",
    icon: "file",
};

export const NotesPluginBase: PluginBase = {
    id: notesPluginSerial.id,
    name: notesPluginSerial.name,
    icon: notesPluginSerial.icon,
    mcpServers: {},
    views,
    functionStubs: functionStubs,
    commands: [], // Commands will be dynamically populated from getNotesCommands
};
