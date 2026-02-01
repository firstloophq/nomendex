import React from "react";
import { Command } from "@/types/Commands";
import { CreateNoteDialog } from "./create-note-dialog";
import { DeleteNoteDialog } from "./delete-note-dialog";
import { RenameNoteDialog } from "./rename-note-dialog";
import { MoveToFolderDialog } from "./move-to-folder-dialog";
import { getTodayDailyNoteFileName, getYesterdayDailyNoteFileName, getTomorrowDailyNoteFileName } from "./date-utils";
import { DailyNoteDatePickerDialog } from "./daily-note-date-picker-dialog";
import { SearchNotesDialog } from "./search-notes-dialog";
import { notesAPI } from "@/hooks/useNotesAPI";
import { notesPluginSerial } from "./index";
import { WorkspaceTab } from "@/types/Workspace";
import { SerializablePlugin } from "@/types/Plugin";
import { emit } from "@/lib/events";

interface CommandContext {
    openDialog: (config: { title?: string; description?: string; content?: React.ReactNode; size?: "default" | "sm" | "md" | "lg" | "xl" | "2xl" | "full" | "jumbo" }) => void;
    closeDialog: () => void;
    closeCommandMenu: () => void;
    addNewTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    openTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    setActiveTabId: (id: string) => void;
    closeTab: (id: string) => void;
    activeTab?: WorkspaceTab | null;
    navigate: (path: string) => void;
    currentPath: string;
}

export function getNotesCommands(context: CommandContext): Command[] {
    return [
        {
            id: "notes.search",
            name: "Search Notes",
            description: "Search across all notes (Cmd+Shift+F)",
            icon: "Search",
            callback: () => {
                context.closeCommandMenu();
                context.openDialog({
                    title: "Search Notes",
                    description: "Search for text across all your notes",
                    content: <SearchNotesDialog />,
                    size: "jumbo",
                });
            },
        },
        {
            id: "notes.create",
            name: "Create New Note",
            description: "Create a new note with custom name",
            icon: "Plus",
            callback: () => {
                context.closeCommandMenu();
                context.openDialog({
                    title: "Create New Note",
                    description: "Enter a name for your new note",
                    content: <CreateNoteDialog />,
                });
            },
        },
        {
            id: "notes.openDaily",
            name: "Open Today's Daily Note",
            description: "Create if missing and open in editor",
            icon: "Calendar",
            callback: async () => {
                context.closeCommandMenu();
                const fileName = getTodayDailyNoteFileName();
                console.log("Daily note file name");
                console.log({ fileName });

                // See if note exists
                const output = await notesAPI.getNoteByFileName({ fileName });
                console.log("Daily note output");
                console.log({ output });
                if (!output) {
                    await notesAPI.createNote({ fileName });
                }

                context.openTab({
                    pluginMeta: notesPluginSerial,
                    view: "editor",
                    props: { noteFileName: fileName },
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "notes.openYesterday",
            name: "Open Yesterday's Daily Note",
            description: "Create if missing and open in editor",
            icon: "CalendarMinus",
            callback: async () => {
                context.closeCommandMenu();
                const fileName = getYesterdayDailyNoteFileName();
                console.log("Yesterday's daily note file name");
                console.log({ fileName });

                // See if note exists
                const output = await notesAPI.getNoteByFileName({ fileName });
                console.log("Yesterday's daily note output");
                console.log({ output });
                if (!output) {
                    await notesAPI.createNote({ fileName });
                }

                context.openTab({
                    pluginMeta: notesPluginSerial,
                    view: "editor",
                    props: { noteFileName: fileName },
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "notes.openTomorrow",
            name: "Open Tomorrow's Daily Note",
            description: "Create if missing and open in editor",
            icon: "CalendarPlus",
            callback: async () => {
                context.closeCommandMenu();
                const fileName = getTomorrowDailyNoteFileName();
                console.log("Tomorrow's daily note file name");
                console.log({ fileName });

                // See if note exists
                const output = await notesAPI.getNoteByFileName({ fileName });
                console.log("Tomorrow's daily note output");
                console.log({ output });
                if (!output) {
                    await notesAPI.createNote({ fileName });
                }

                context.openTab({
                    pluginMeta: notesPluginSerial,
                    view: "editor",
                    props: { noteFileName: fileName },
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "notes.openDailyPicker",
            name: "Open Daily Note...",
            description: "Pick a date to open or create a daily note",
            icon: "CalendarDays",
            callback: () => {
                context.closeCommandMenu();
                context.openDialog({
                    title: "Open Daily Note",
                    description: "Select a date to open or create a daily note",
                    content: <DailyNoteDatePickerDialog />,
                });
            },
        },
        {
            id: "notes.open",
            name: "Notes",
            description: "Open the notes browser",
            icon: "FileText",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: notesPluginSerial,
                    view: "browser",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "notes.save",
            name: "Save Current Note",
            description: "Save the current note (Cmd+S)",
            icon: "Save",
            // Only show when editor view is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                // This would trigger save in the editor
                // For now just a placeholder
                console.log("Save command triggered - would save current note");
            },
        },
        {
            id: "notes.delete",
            name: "Delete Current Note",
            description: "Delete the currently open note",
            icon: "Trash2",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                console.log("Running delete note command");
                context.closeCommandMenu();

                // Get the current note filename from active tab props
                console.error({ context });
                const noteFileName = context.activeTab?.pluginInstance?.instanceProps?.noteFileName as string;
                const plugin = context.activeTab?.pluginInstance?.plugin;
                console.log({ noteFileName, plugin });
                if (!noteFileName) {
                    console.error("No note file name found in active tab");
                    return;
                }

                context.openDialog({
                    content: (
                        <DeleteNoteDialog
                            noteFileName={noteFileName}
                            onSuccess={() => {
                                // Dialog handles closing tabs and refreshing
                            }}
                        />
                    ),
                });
            },
        },
        {
            id: "notes.rename",
            name: "Rename Current Note",
            description: "Rename the currently open note",
            icon: "Edit",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                context.closeCommandMenu();

                // Get the current note filename from active tab props
                const noteFileName = context.activeTab?.pluginInstance?.instanceProps?.noteFileName as string;
                if (!noteFileName) {
                    console.error("No note file name found in active tab");
                    return;
                }

                context.openDialog({
                    content: (
                        <RenameNoteDialog
                            noteFileName={noteFileName}
                            onSuccess={() => {
                                // Dialog handles updating tabs
                            }}
                        />
                    ),
                });
            },
        },
        {
            id: "notes.moveToFolder",
            name: "Move Note to Folder",
            description: "Move the current note to a different folder",
            icon: "FolderInput",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                context.closeCommandMenu();

                // Get the current note filename and folder from active tab props
                const noteFileName = context.activeTab?.pluginInstance?.instanceProps?.noteFileName as string;
                if (!noteFileName) {
                    console.error("No note file name found in active tab");
                    return;
                }

                // Extract current folder from fileName (e.g., "folder/subfolder/file.md" -> "folder/subfolder")
                const lastSlash = noteFileName.lastIndexOf("/");
                const currentFolder = lastSlash > 0 ? noteFileName.substring(0, lastSlash) : undefined;

                context.openDialog({
                    content: (
                        <MoveToFolderDialog
                            noteFileName={noteFileName}
                            currentFolder={currentFolder}
                            onSuccess={() => {
                                // Dialog handles updating tabs
                            }}
                        />
                    ),
                });
            },
        },
        {
            id: "notes.copyMarkdown",
            name: "Copy Markdown",
            description: "Copy the note content as markdown",
            icon: "Copy",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                context.closeCommandMenu();

                // Get the current note filename from active tab props
                const noteFileName = context.activeTab?.pluginInstance?.instanceProps?.noteFileName as string;
                if (!noteFileName) {
                    console.error("No note file name found in active tab");
                    return;
                }

                // Emit event for the note view to handle copying
                emit("notes:copyMarkdown", { noteFileName });
            },
        },
        {
            id: "notes.revealInFinder",
            name: "Reveal in Finder",
            description: "Show the current note in Finder",
            icon: "Folder",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: async () => {
                context.closeCommandMenu();

                // Get the current note filename from active tab props
                const noteFileName = context.activeTab?.pluginInstance?.instanceProps?.noteFileName as string;
                if (!noteFileName) {
                    console.error("No note file name found in active tab");
                    return;
                }

                await notesAPI.revealInFinder({ fileName: noteFileName });
            },
        },
        {
            id: "notes.runSpellcheck",
            name: "Run Spellcheck",
            description: "Check spelling and highlight misspelled words",
            icon: "SpellCheck",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                context.closeCommandMenu();
                emit("notes:runSpellcheck", {});
            },
        },
        {
            id: "notes.clearSpellcheck",
            name: "Clear Spellcheck",
            description: "Remove all spellcheck highlighting",
            icon: "SpellCheck2",
            // Only show when notes editor is active
            when: {
                activeViewId: "editor",
            },
            callback: () => {
                context.closeCommandMenu();
                emit("notes:clearSpellcheck", {});
            },
        },
        {
            id: "notes.rebuildTagsIndex",
            name: "Rebuild Tags Index",
            description: "Clear cache and reparse all tags from notes",
            icon: "RefreshCw",
            callback: async () => {
                context.closeCommandMenu();
                const result = await notesAPI.rebuildTagsIndex();
                console.log(`Tags index rebuilt: ${result.tagCount} tags found`);
            },
        },
    ];
}
