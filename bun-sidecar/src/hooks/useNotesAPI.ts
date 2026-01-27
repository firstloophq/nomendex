import { Note, NoteFolder, SearchResult } from "@/features/notes";
import { BacklinksResult } from "@/features/notes/backlinks-types";
import type { TagSuggestion } from "@/features/notes/tags-types";

async function fetchAPI<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`/api/notes/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

// Simple LRU cache for note content
const NOTE_CACHE_SIZE = 20;
const noteCache = new Map<string, { note: Note; timestamp: number }>();

function getCachedNote(fileName: string): Note | null {
    const cached = noteCache.get(fileName);
    if (cached) {
        // Update timestamp on access (LRU behavior)
        cached.timestamp = Date.now();
        return cached.note;
    }
    return null;
}

function setCachedNote(fileName: string, note: Note): void {
    // Evict oldest if at capacity
    if (noteCache.size >= NOTE_CACHE_SIZE) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [key, value] of noteCache) {
            if (value.timestamp < oldestTime) {
                oldestTime = value.timestamp;
                oldestKey = key;
            }
        }
        if (oldestKey) noteCache.delete(oldestKey);
    }
    noteCache.set(fileName, { note, timestamp: Date.now() });
}

function invalidateNoteCache(fileName: string): void {
    noteCache.delete(fileName);
}

// Preload a note into cache (fire and forget)
function preloadNote(fileName: string): void {
    if (noteCache.has(fileName)) return;
    fetchAPI<Note>("get", { fileName }).then((note) => {
        setCachedNote(fileName, note);
    }).catch(() => {
        // Ignore preload errors
    });
}

// Standalone API object for use outside React components
export const notesAPI = {
    getNotes: () => fetchAPI<Note[]>("list"),
    searchNotes: (args: { query: string }) => fetchAPI<SearchResult[]>("search", args),
    getNoteByFileName: async (args: { fileName: string; skipCache?: boolean }): Promise<Note> => {
        // Check cache first (unless skipCache is true)
        if (!args.skipCache) {
            const cached = getCachedNote(args.fileName);
            if (cached) return cached;
        }
        // Fetch and cache
        const note = await fetchAPI<Note>("get", { fileName: args.fileName });
        setCachedNote(args.fileName, note);
        return note;
    },
    preloadNote,
    createNote: async (args: { fileName: string; content?: string }): Promise<Note> => {
        const note = await fetchAPI<Note>("create", args);
        setCachedNote(args.fileName, note);
        return note;
    },
    saveNote: async (args: { fileName: string; content: string }): Promise<Note> => {
        const note = await fetchAPI<Note>("save", args);
        setCachedNote(args.fileName, note);
        return note;
    },
    deleteNote: async (args: { fileName: string }): Promise<{ success: boolean }> => {
        const result = await fetchAPI<{ success: boolean }>("delete", args);
        invalidateNoteCache(args.fileName);
        return result;
    },
    renameNote: async (args: { oldFileName: string; newFileName: string }): Promise<Note> => {
        const note = await fetchAPI<Note>("rename", args);
        invalidateNoteCache(args.oldFileName);
        setCachedNote(args.newFileName, note);
        return note;
    },
    updateNoteTags: (args: { fileName: string; tags: string[] }) => fetchAPI<Note>("update-tags", args),
    getDailyNoteName: () => fetchAPI<{ fileName: string }>("daily-name"),
    getRecentDailyNotes: (args: { days?: number } = {}) =>
        fetchAPI<
            Array<{
                date: string;
                fileName: string;
                exists: boolean;
                content?: string;
                frontMatter?: Record<string, unknown>;
            }>
        >("recent-daily", args),
    // Folder operations
    getFolders: () => fetchAPI<NoteFolder[]>("folders"),
    createFolder: (args: { name: string; parentPath?: string }) => fetchAPI<NoteFolder>("folders/create", args),
    deleteFolder: (args: { folderPath: string }) => fetchAPI<{ success: boolean }>("folders/delete", args),
    renameFolder: (args: { oldPath: string; newName: string }) => fetchAPI<NoteFolder>("folders/rename", args),
    moveNoteToFolder: async (args: { fileName: string; targetFolder: string | null }): Promise<Note> => {
        const note = await fetchAPI<Note>("move-to-folder", args);
        invalidateNoteCache(args.fileName);
        if (note.fileName !== args.fileName) {
            setCachedNote(note.fileName, note);
        }
        return note;
    },
    // Backlinks operations
    getBacklinks: (args: { fileName: string }) => fetchAPI<BacklinksResult>("backlinks/get", args),
    getAllPhantomLinks: () =>
        fetchAPI<Array<{ targetName: string; referencedIn: string[] }>>("backlinks/phantoms"),
    rebuildBacklinksIndex: () => fetchAPI<{ fileCount: number }>("backlinks/rebuild"),
    // Tags operations
    getAllTags: () => fetchAPI<TagSuggestion[]>("tags/list"),
    searchTags: (args: { query: string }) => fetchAPI<TagSuggestion[]>("tags/search", args),
    getTagsForFile: (args: { fileName: string }) => fetchAPI<string[]>("tags/for-file", args),
    getFilesWithTag: (args: { tag: string }) => fetchAPI<string[]>("tags/files-with", args),
    rebuildTagsIndex: () => fetchAPI<{ tagCount: number }>("tags/rebuild"),
    // Project operations
    updateNoteProject: async (args: { fileName: string; project: string | null }): Promise<Note> => {
        const note = await fetchAPI<Note>("update-project", args);
        setCachedNote(args.fileName, note);
        return note;
    },
    getNotesByProject: (args: { project: string }) => fetchAPI<Note[]>("by-project", args),
    getNoteMtime: (args: { fileName: string }) => fetchAPI<{ mtime: number | null }>("mtime", args),
    revealInFinder: (args: { fileName: string }) => fetchAPI<{ success: boolean }>("reveal-in-finder", args),
};

// Hook wrapper for use in React components
export function useNotesAPI() {
    return notesAPI;
}
