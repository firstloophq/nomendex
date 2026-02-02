// Direct API routes for notes feature
// These replace the generic /api/plugin-registry endpoint

import { functions } from "@/features/notes/fx";
import {
    getBacklinksForNote,
    getAllPhantomLinks,
    rebuildIndex,
    onNoteSaved,
    onNoteDeleted,
    onNoteRenamed,
    onNoteCreated,
} from "@/features/notes/backlinks-service";
import {
    getAllTags,
    searchTags,
    getTagsForFile,
    getFilesWithTag,
    rebuildTagsIndex,
    onNoteSavedTags,
    onNoteDeletedTags,
    onNoteRenamedTags,
    createExplicitTag,
    deleteExplicitTag,
    isExplicitTag,
    getExplicitTags,
} from "@/features/notes/tags-service";

export const notesRoutes = {
    "/api/notes/list": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.getNotes.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/search": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.searchNotes.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.getNoteByFileName.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/create": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.createNote.fx(args);
            // Update backlinks index (resolves phantom if applicable)
            await onNoteCreated({ fileName: result.fileName });
            return Response.json(result);
        },
    },
    "/api/notes/save": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.saveNote.fx(args);
            // Update backlinks and tags indexes
            await onNoteSaved({ fileName: args.fileName, content: args.content });
            await onNoteSavedTags({ fileName: args.fileName, content: args.content });
            return Response.json(result);
        },
    },
    "/api/notes/delete": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.deleteNote.fx(args);
            // Update backlinks and tags indexes
            await onNoteDeleted({ fileName: args.fileName });
            await onNoteDeletedTags({ fileName: args.fileName });
            return Response.json(result);
        },
    },
    "/api/notes/rename": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.renameNote.fx(args);
            // Update backlinks and tags indexes
            await onNoteRenamed({ oldFileName: args.oldFileName, newFileName: result.fileName });
            await onNoteRenamedTags({ oldFileName: args.oldFileName, newFileName: result.fileName });
            return Response.json(result);
        },
    },
    "/api/notes/update-tags": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.updateNoteTags.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/daily-name": {
        async POST() {
            const result = await functions.getDailyNoteName.fx({});
            return Response.json(result);
        },
    },
    "/api/notes/recent-daily": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.getRecentDailyNotes.fx(args);
            return Response.json(result);
        },
    },
    // Folder routes
    "/api/notes/folders": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.getFolders.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/folders/create": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.createFolder.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/folders/delete": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.deleteFolder.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/folders/rename": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.renameFolder.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/move-to-folder": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.moveNoteToFolder.fx(args);
            return Response.json(result);
        },
    },
    // Backlinks routes
    "/api/notes/backlinks/get": {
        async POST(req: Request) {
            const args = (await req.json()) as { fileName: string };
            const result = getBacklinksForNote({ fileName: args.fileName });
            return Response.json(result);
        },
    },
    "/api/notes/backlinks/phantoms": {
        async POST() {
            const result = getAllPhantomLinks();
            return Response.json(result);
        },
    },
    "/api/notes/backlinks/rebuild": {
        async POST() {
            const result = await rebuildIndex();
            return Response.json(result);
        },
    },
    // Tags routes
    "/api/notes/tags/list": {
        async POST() {
            const result = getAllTags();
            return Response.json(result);
        },
    },
    "/api/notes/tags/search": {
        async POST(req: Request) {
            const args = (await req.json()) as { query: string };
            const result = searchTags({ query: args.query });
            return Response.json(result);
        },
    },
    "/api/notes/tags/for-file": {
        async POST(req: Request) {
            const args = (await req.json()) as { fileName: string };
            const result = getTagsForFile({ fileName: args.fileName });
            return Response.json(result);
        },
    },
    "/api/notes/tags/files-with": {
        async POST(req: Request) {
            const args = (await req.json()) as { tag: string };
            const result = getFilesWithTag({ tag: args.tag });
            return Response.json(result);
        },
    },
    "/api/notes/tags/rebuild": {
        async POST() {
            const result = await rebuildTagsIndex();
            return Response.json(result);
        },
    },
    "/api/notes/tags/create-explicit": {
        async POST(req: Request) {
            try {
                const args = (await req.json()) as { tagName: string };
                const result = await createExplicitTag({ tagName: args.tagName });
                return Response.json(result);
            } catch (error) {
                // Return 400 for validation errors (which createExplicitTag throws), 500 for others
                const message = error instanceof Error ? error.message : "Unknown error";
                const status = message.includes("Invalid tag name") ? 400 : 500;
                return Response.json({ error: message }, { status });
            }
        },
    },
    "/api/notes/tags/delete-explicit": {
        async POST(req: Request) {
            const args = (await req.json()) as { tagName: string };
            const result = await deleteExplicitTag({ tagName: args.tagName });
            return Response.json(result);
        },
    },
    "/api/notes/tags/is-explicit": {
        async POST(req: Request) {
            const args = (await req.json()) as { tagName: string };
            const result = isExplicitTag({ tagName: args.tagName });
            return Response.json({ isExplicit: result });
        },
    },
    "/api/notes/tags/list-explicit": {
        async POST() {
            const result = getExplicitTags();
            return Response.json(result);
        },
    },
    // Project routes
    "/api/notes/update-project": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.updateNoteProject.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/by-project": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.getNotesByProject.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/mtime": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.getNoteMtime.fx(args);
            return Response.json(result);
        },
    },
    "/api/notes/reveal-in-finder": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await functions.revealInFinder.fx(args);
            return Response.json(result);
        },
    },
};
