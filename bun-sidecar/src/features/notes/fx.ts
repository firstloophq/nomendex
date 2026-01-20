import { TypedPluginWithFunctions } from "@/types/Plugin";
import { functionStubs, NotesPluginBase } from "./index";
import { FunctionsFromStubs } from "@/types/Functions";
import { FeatureStorage } from "@/storage/FeatureStorage";
import { getNotesPath, hasActiveWorkspace } from "@/storage/root-path";
import yaml from "js-yaml";

// Lazy-initialized storage for notes
let storage: FeatureStorage | null = null;

/**
 * Initialize the notes service. Must be called after initializePaths().
 */
export async function initializeNotesService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        return;
    }
    storage = new FeatureStorage(getNotesPath());
    await getStorage().initialize();
}

function getStorage(): FeatureStorage {
    if (!storage) {
        throw new Error("Notes service not initialized. Call initializeNotesService() first.");
    }
    return storage;
}

// Parse YAML front matter from markdown content
function parseFrontMatter(content: string): { frontMatter: Record<string, unknown> | undefined; content: string } {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontMatterRegex);

    if (!match) {
        return { frontMatter: undefined, content };
    }

    try {
        const frontMatterYaml = match[1];
        const frontMatter = yaml.load(frontMatterYaml) as Record<string, unknown>;
        const contentWithoutFrontMatter = content.slice(match[0].length);
        return { frontMatter, content: contentWithoutFrontMatter };
    } catch {
        // If YAML parsing fails, return content as-is
        return { frontMatter: undefined, content };
    }
}

// Serialize front matter back to YAML and prepend to content
function serializeFrontMatter(frontMatter: Record<string, unknown> | undefined, content: string): string {
    if (!frontMatter || Object.keys(frontMatter).length === 0) {
        return content;
    }

    try {
        const yamlString = yaml.dump(frontMatter, { lineWidth: -1 });
        return `---\n${yamlString}---\n${content}`;
    } catch {
        // If serialization fails, return content as-is
        return content;
    }
}
async function getNotes() {
    try {
        const notes: { fileName: string; content: string; frontMatter?: Record<string, unknown>; folderPath?: string }[] = [];

        // Get root-level files
        const rootFiles = await getStorage().listFiles();
        for (const file of rootFiles) {
            if (!file.endsWith(".md")) continue;
            let rawContent = await getStorage().readFile(file);
            if (!rawContent) rawContent = "";
            const { frontMatter, content } = parseFrontMatter(rawContent);
            notes.push({ fileName: file, content, frontMatter, folderPath: undefined });
        }

        // Get files from all folders recursively
        const folders = await getStorage().listAllFoldersRecursive();
        for (const folder of folders) {
            // Skip system directories
            if (folder.path.startsWith("todos") || folder.path.startsWith(".nomendex") || folder.path.startsWith(".git") || folder.path.includes("/.")) {
                continue;
            }

            const folderFiles = await getStorage().listFiles(folder.path);
            for (const file of folderFiles) {
                if (!file.endsWith(".md")) continue;
                const filePath = `${folder.path}/${file}`;
                let rawContent = await getStorage().readFile(filePath);
                if (!rawContent) rawContent = "";
                const { frontMatter, content } = parseFrontMatter(rawContent);
                notes.push({ fileName: filePath, content, frontMatter, folderPath: folder.path });
            }
        }

        return notes;
    } catch {
        // Return empty array if notes directory doesn't exist
        return [];
    }
}

async function getNoteByFileName(args: { fileName: string }) {
    const rawContent = await getStorage().readFile(args.fileName);
    const mtime = await getStorage().getFileMtime(args.fileName);
    if (!rawContent) {
        return { fileName: args.fileName, content: "", frontMatter: undefined, folderPath: undefined, mtime: mtime ?? undefined };
    }

    const { frontMatter, content } = parseFrontMatter(rawContent);
    // Extract folder path from fileName
    const lastSlash = args.fileName.lastIndexOf("/");
    const folderPath = lastSlash > 0 ? args.fileName.substring(0, lastSlash) : undefined;
    return { fileName: args.fileName, content, frontMatter, folderPath, mtime: mtime ?? undefined };
}

async function saveNote(args: { fileName: string; content: string }) {
    try {
        // Read existing file to preserve front matter
        const existingContent = await getStorage().readFile(args.fileName);
        let frontMatter: Record<string, unknown> | undefined;

        if (existingContent) {
            const parsed = parseFrontMatter(existingContent);
            frontMatter = parsed.frontMatter;
        }

        // Strip any front matter from incoming content (in case it leaked through)
        const { content: cleanContent } = parseFrontMatter(args.content);

        // Combine front matter with clean content
        const contentToSave = frontMatter ? serializeFrontMatter(frontMatter, cleanContent) : cleanContent;
        await getStorage().writeFile(args.fileName, contentToSave);

        // Get the new mtime after writing
        const mtime = await getStorage().getFileMtime(args.fileName);

        return { fileName: args.fileName, content: cleanContent, frontMatter, mtime: mtime ?? undefined };
    } catch (error) {
        throw new Error(`Failed to save note: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

async function createNote(args: { fileName: string; content?: string }) {
    try {
        const exists = await getStorage().fileExists(args.fileName);

        if (exists) {
            const note = await getNoteByFileName({ fileName: args.fileName });
            if (!note) {
                throw new Error(`Note ${args.fileName} not found`);
            }
            const { content, fileName, frontMatter } = note;
            return { fileName, content, frontMatter };
        }

        // Create with basic Markdown template
        const contentToWrite = args.content || "";
        await getStorage().createFile(args.fileName, contentToWrite);

        const { frontMatter } = parseFrontMatter(contentToWrite);
        return { fileName: args.fileName, content: contentToWrite, frontMatter };
    } catch (error) {
        throw new Error(`Failed to create note: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

async function deleteNote(args: { fileName: string }) {
    try {
        const exists = await getStorage().fileExists(args.fileName);

        if (!exists) {
            throw new Error(`Note ${args.fileName} not found`);
        }

        await getStorage().deleteFile(args.fileName);
        return { success: true };
    } catch (error) {
        throw new Error(`Failed to delete note: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

async function renameNote(args: { oldFileName: string; newFileName: string }) {
    try {
        // Ensure .md extension on new name only (old name comes from system with extension)
        const newName = args.newFileName.endsWith(".md") ? args.newFileName : `${args.newFileName}.md`;

        // Check that old file exists
        const oldExists = await getStorage().fileExists(args.oldFileName);
        if (!oldExists) {
            throw new Error(`Note ${args.oldFileName} not found`);
        }

        // Check that new file doesn't already exist
        const newExists = await getStorage().fileExists(newName);
        if (newExists) {
            throw new Error(`A note named ${newName} already exists`);
        }

        // Read the old file content
        const rawContent = await getStorage().readFile(args.oldFileName);
        if (rawContent === null) {
            throw new Error(`Failed to read note ${args.oldFileName}`);
        }

        // Write to new file
        await getStorage().writeFile(newName, rawContent);

        // Delete old file
        await getStorage().deleteFile(args.oldFileName);

        // Parse and return the note with new fileName
        const { frontMatter, content } = parseFrontMatter(rawContent);
        return { fileName: newName, content, frontMatter };
    } catch (error) {
        throw new Error(`Failed to rename note: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

async function updateNoteTags(args: { fileName: string; tags: string[] }) {
    try {
        const rawContent = await getStorage().readFile(args.fileName);

        if (!rawContent) {
            throw new Error(`Note ${args.fileName} not found`);
        }

        const { frontMatter, content } = parseFrontMatter(rawContent);
        const updatedFrontMatter = { ...frontMatter, tags: args.tags };

        // Serialize the updated front matter with content
        const yamlString = yaml.dump(updatedFrontMatter, { lineWidth: -1 });
        const fileContent = `---\n${yamlString}---\n${content}`;

        await getStorage().writeFile(args.fileName, fileContent);

        // Return content WITHOUT front matter (for editor display)
        return { fileName: args.fileName, content, frontMatter: updatedFrontMatter };
    } catch (error) {
        throw new Error(`Failed to update tags: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

async function updateNoteProject(args: { fileName: string; project: string | null }) {
    try {
        const rawContent = await getStorage().readFile(args.fileName);

        if (!rawContent) {
            throw new Error(`Note ${args.fileName} not found`);
        }

        const { frontMatter, content } = parseFrontMatter(rawContent);
        const updatedFrontMatter = { ...frontMatter };

        if (args.project) {
            updatedFrontMatter.project = args.project;
        } else {
            delete updatedFrontMatter.project;
        }

        // Serialize the updated front matter with content
        const yamlString = yaml.dump(updatedFrontMatter, { lineWidth: -1 });
        const fileContent = `---\n${yamlString}---\n${content}`;

        await getStorage().writeFile(args.fileName, fileContent);

        // Return content WITHOUT front matter (for editor display)
        return { fileName: args.fileName, content, frontMatter: updatedFrontMatter };
    } catch (error) {
        throw new Error(`Failed to update project: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

async function getNotesByProject(args: { project: string }) {
    try {
        const allNotes = await getNotes();
        return allNotes.filter((note) => note.frontMatter?.project === args.project);
    } catch {
        return [];
    }
}

async function getNoteMtime(args: { fileName: string }) {
    const mtime = await getStorage().getFileMtime(args.fileName);
    return { mtime };
}

async function getDailyNoteName() {
    const date = new Date();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    return { fileName: `${month}-${day}-${year}` };
}

async function getRecentDailyNotes(args: { days?: number }) {
    const days = args.days ?? 7;
    const results: Array<{
        date: string;
        fileName: string;
        exists: boolean;
        content?: string;
        frontMatter?: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear();
        const fileName = `${month}-${day}-${year}.md`;
        const dateStr = date.toISOString().split("T")[0] || "";

        const exists = await getStorage().fileExists(fileName);

        if (exists) {
            const rawContent = await getStorage().readFile(fileName);
            if (rawContent) {
                const { frontMatter, content } = parseFrontMatter(rawContent);
                results.push({ date: dateStr, fileName, exists: true, content, frontMatter });
            } else {
                results.push({ date: dateStr, fileName, exists: true, content: "" });
            }
        } else {
            results.push({ date: dateStr, fileName, exists: false });
        }
    }

    return results;
}

// ============ Folder Functions ============

async function getFolders() {
    try {
        const folders = await getStorage().listAllFoldersRecursive();
        return folders;
    } catch {
        return [];
    }
}

async function createFolder(args: { name: string; parentPath?: string }) {
    const folderPath = args.parentPath ? `${args.parentPath}/${args.name}` : args.name;
    await getStorage().createFolder(folderPath);
    return { name: args.name, path: folderPath };
}

async function deleteFolder(args: { folderPath: string }) {
    await getStorage().deleteFolder(args.folderPath);
    return { success: true };
}

async function renameFolder(args: { oldPath: string; newName: string }) {
    // Get the parent path
    const lastSlash = args.oldPath.lastIndexOf("/");
    const parentPath = lastSlash > 0 ? args.oldPath.substring(0, lastSlash) : "";
    const newPath = parentPath ? `${parentPath}/${args.newName}` : args.newName;

    // Get all files in the old folder
    const files = await getStorage().listFiles(args.oldPath);
    const subFolders = await getStorage().listAllFoldersRecursive(args.oldPath);

    // Create new folder
    await getStorage().createFolder(newPath);

    // Move all files
    for (const file of files) {
        const oldFilePath = `${args.oldPath}/${file}`;
        const newFilePath = `${newPath}/${file}`;
        await getStorage().moveFile(oldFilePath, newFilePath);
    }

    // Move all subfolders recursively
    for (const subFolder of subFolders) {
        const relativePath = subFolder.path.substring(args.oldPath.length + 1);
        const newSubPath = `${newPath}/${relativePath}`;
        await getStorage().createFolder(newSubPath);

        const subFiles = await getStorage().listFiles(subFolder.path);
        for (const file of subFiles) {
            const oldFilePath = `${subFolder.path}/${file}`;
            const newFilePath = `${newSubPath}/${file}`;
            await getStorage().moveFile(oldFilePath, newFilePath);
        }
    }

    // Delete old folder
    await getStorage().deleteFolder(args.oldPath);

    return { name: args.newName, path: newPath };
}

async function revealNoteInFinder(args: { fileName: string }) {
    const path = await import("path");
    const absolutePath = path.join(getNotesPath(), args.fileName);
    Bun.spawn(["open", "-R", absolutePath]);
    return { success: true };
}

async function moveNoteToFolder(args: { fileName: string; targetFolder: string | null }) {
    // Extract just the file name (without path)
    const lastSlash = args.fileName.lastIndexOf("/");
    const justFileName = lastSlash >= 0 ? args.fileName.substring(lastSlash + 1) : args.fileName;

    // Build new path
    const newPath = args.targetFolder ? `${args.targetFolder}/${justFileName}` : justFileName;

    if (args.fileName === newPath) {
        // Already in the target location
        return await getNoteByFileName({ fileName: args.fileName });
    }

    // Move the file
    await getStorage().moveFile(args.fileName, newPath);

    // Return the updated note
    return await getNoteByFileName({ fileName: newPath });
}

export const functions: FunctionsFromStubs<typeof functionStubs> = {
    getNotes: { ...functionStubs.getNotes, fx: getNotes },
    getNoteByFileName: { ...functionStubs.getNoteByFileName, fx: getNoteByFileName },
    createNote: { ...functionStubs.createNote, fx: createNote },
    saveNote: { ...functionStubs.saveNote, fx: saveNote },
    updateNoteTags: { ...functionStubs.updateNoteTags, fx: updateNoteTags },
    updateNoteProject: { ...functionStubs.updateNoteProject, fx: updateNoteProject },
    getNotesByProject: { ...functionStubs.getNotesByProject, fx: getNotesByProject },
    deleteNote: { ...functionStubs.deleteNote, fx: deleteNote },
    renameNote: { ...functionStubs.renameNote, fx: renameNote },
    getDailyNoteName: { ...functionStubs.getDailyNoteName, fx: getDailyNoteName },
    getRecentDailyNotes: { ...functionStubs.getRecentDailyNotes, fx: getRecentDailyNotes },
    getFolders: { ...functionStubs.getFolders, fx: getFolders },
    createFolder: { ...functionStubs.createFolder, fx: createFolder },
    deleteFolder: { ...functionStubs.deleteFolder, fx: deleteFolder },
    renameFolder: { ...functionStubs.renameFolder, fx: renameFolder },
    moveNoteToFolder: { ...functionStubs.moveNoteToFolder, fx: moveNoteToFolder },
    getNoteMtime: { ...functionStubs.getNoteMtime, fx: getNoteMtime },
    revealInFinder: { ...functionStubs.revealInFinder, fx: revealNoteInFinder },
};

export const NotesPluginWithFunctions: TypedPluginWithFunctions<typeof functionStubs> = {
    ...NotesPluginBase,
    functions,
};
