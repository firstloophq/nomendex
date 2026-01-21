/**
 * Tags Service
 *
 * Manages the tags index for #hashtag autocomplete in notes.
 * Index is stored at {workspace}/.nomendex/tags.json
 */

import { mkdir } from "node:fs/promises";
import { join } from "path";
import { getNomendexPath, getNotesPath, getTodosPath, hasActiveWorkspace } from "@/storage/root-path";
import { StringSet } from "./backlinks-types";
import { TagsIndex, TagSuggestion, createEmptyTagsIndex } from "./tags-types";
import type { FileIndexData } from "./notes-indexer";

// In-memory index for fast queries
let index: TagsIndex | null = null;

// Regex to extract #tags from markdown
// Matches #tag but not inside code blocks or URLs
// Tag must start with letter/underscore, can contain letters, numbers, underscores, hyphens
const TAG_REGEX = /(?:^|[\s\[\(])#([a-zA-Z_][a-zA-Z0-9_-]*)/g;

/**
 * Extract tags from markdown content
 */
export function extractTags(content: string): string[] {
    const tags: string[] = [];
    let match;

    // Reset regex state
    TAG_REGEX.lastIndex = 0;

    // Remove code blocks to avoid matching tags inside them
    const contentWithoutCode = content
        .replace(/```[\s\S]*?```/g, "") // fenced code blocks
        .replace(/`[^`]+`/g, ""); // inline code

    while ((match = TAG_REGEX.exec(contentWithoutCode)) !== null) {
        const tag = match[1];
        if (tag) {
            tags.push(tag.toLowerCase()); // Normalize to lowercase
        }
    }

    // Dedupe
    return [...new Set(tags)];
}

/**
 * Get the path to the tags index file
 */
function getIndexPath(): string {
    return join(getNomendexPath(), "tags.json");
}

/**
 * Load the index from disk
 */
async function loadIndexFromDisk(): Promise<TagsIndex | null> {
    try {
        const indexPath = getIndexPath();
        const file = Bun.file(indexPath);
        if (!(await file.exists())) {
            return null;
        }
        const content = await file.text();
        return JSON.parse(content) as TagsIndex;
    } catch {
        return null;
    }
}

/**
 * Save the index to disk
 */
async function saveIndexToDisk(indexToSave: TagsIndex): Promise<void> {
    const nomendexPath = getNomendexPath();
    await mkdir(nomendexPath, { recursive: true });
    const indexPath = getIndexPath();
    await Bun.write(indexPath, JSON.stringify(indexToSave, null, 2));
}

/**
 * File reference with source directory prefix
 * Format: "notes:path/to/file.md" or "todos:path/to/file.md"
 */
type FileRef = string;

/**
 * Parse a file reference to get source and path
 */
function parseFileRef(fileRef: FileRef): { source: "notes" | "todos"; path: string } {
    if (fileRef.startsWith("notes:")) {
        return { source: "notes", path: fileRef.slice(6) };
    } else if (fileRef.startsWith("todos:")) {
        return { source: "todos", path: fileRef.slice(6) };
    }
    // Default to notes for backwards compatibility
    return { source: "notes", path: fileRef };
}

/**
 * Get the full file path from a file reference
 */
function getFullPath(fileRef: FileRef): string {
    const { source, path } = parseFileRef(fileRef);
    const basePath = source === "todos" ? getTodosPath() : getNotesPath();
    return join(basePath, path);
}

/**
 * Get all .md files in both notes and todos directories
 */
async function getAllFiles(): Promise<FileRef[]> {
    const files: FileRef[] = [];
    const glob = new Bun.Glob("**/*.md");

    // Scan notes directory
    const notesPath = getNotesPath();
    for await (const file of glob.scan({ cwd: notesPath })) {
        files.push(`notes:${file}`);
    }

    // Scan todos directory
    const todosPath = getTodosPath();
    for await (const file of glob.scan({ cwd: todosPath })) {
        files.push(`todos:${file}`);
    }

    return files;
}

/**
 * Get file modification time
 */
async function getFileMtime(fileRef: FileRef): Promise<number> {
    const filePath = getFullPath(fileRef);
    const file = Bun.file(filePath);
    const stat = await file.stat();
    return stat.mtime.getTime();
}

/**
 * Read file content
 */
async function readFileContent(fileRef: FileRef): Promise<string> {
    const filePath = getFullPath(fileRef);
    return await Bun.file(filePath).text();
}

/**
 * Update index for a single file
 */
function updateFileInIndex(params: {
    indexRef: TagsIndex;
    fileName: string;
    content: string;
}): void {
    const { indexRef, fileName, content } = params;

    // 1. Remove old tags for this file
    const oldTags = indexRef.fileTags[fileName];
    if (oldTags) {
        for (const tag of Object.keys(oldTags)) {
            if (indexRef.tags[tag]) {
                StringSet.remove(indexRef.tags[tag], fileName);
                if (StringSet.isEmpty(indexRef.tags[tag])) {
                    delete indexRef.tags[tag];
                }
            }
        }
    }

    // 2. Extract new tags
    const newTags = extractTags(content);

    // 3. Update fileTags index
    if (newTags.length > 0) {
        indexRef.fileTags[fileName] = StringSet.fromArray(newTags);
    } else {
        delete indexRef.fileTags[fileName];
    }

    // 4. Update tags index
    for (const tag of newTags) {
        if (!indexRef.tags[tag]) {
            indexRef.tags[tag] = StringSet.create();
        }
        StringSet.add(indexRef.tags[tag], fileName);
    }
}

/**
 * Remove file from index
 */
function removeFileFromIndex(params: {
    indexRef: TagsIndex;
    fileName: string;
}): void {
    const { indexRef, fileName } = params;

    // Remove all tags for this file
    const oldTags = indexRef.fileTags[fileName];
    if (oldTags) {
        for (const tag of Object.keys(oldTags)) {
            if (indexRef.tags[tag]) {
                StringSet.remove(indexRef.tags[tag], fileName);
                if (StringSet.isEmpty(indexRef.tags[tag])) {
                    delete indexRef.tags[tag];
                }
            }
        }
    }

    delete indexRef.fileTags[fileName];
    delete indexRef.mtimes[fileName];
}

/**
 * Build a full index from scratch
 */
async function buildFullIndex(): Promise<TagsIndex> {
    const newIndex = createEmptyTagsIndex();
    const files = await getAllFiles();

    for (const file of files) {
        const content = await readFileContent(file);
        const mtime = await getFileMtime(file);
        newIndex.mtimes[file] = mtime;
        updateFileInIndex({
            indexRef: newIndex,
            fileName: file,
            content,
        });
    }

    newIndex.lastFullScan = new Date().toISOString();
    return newIndex;
}

/**
 * Refresh index - only update modified files
 */
async function refreshIndex(currentIndex: TagsIndex): Promise<{
    index: TagsIndex;
    updated: number;
    removed: number;
}> {
    const files = await getAllFiles();
    const existingFiles = StringSet.fromArray(files);

    const needsUpdate: string[] = [];
    const toRemove: string[] = [];

    // Find new/modified files
    for (const file of files) {
        const mtime = await getFileMtime(file);
        if (!currentIndex.mtimes[file] || currentIndex.mtimes[file] !== mtime) {
            needsUpdate.push(file);
            currentIndex.mtimes[file] = mtime;
        }
    }

    // Find deleted files
    for (const file of Object.keys(currentIndex.mtimes)) {
        if (!StringSet.has(existingFiles, file)) {
            toRemove.push(file);
        }
    }

    // Apply removals
    for (const file of toRemove) {
        removeFileFromIndex({ indexRef: currentIndex, fileName: file });
    }

    // Apply updates
    for (const file of needsUpdate) {
        const content = await readFileContent(file);
        updateFileInIndex({
            indexRef: currentIndex,
            fileName: file,
            content,
        });
    }

    currentIndex.lastFullScan = new Date().toISOString();

    return {
        index: currentIndex,
        updated: needsUpdate.length,
        removed: toRemove.length,
    };
}

// ============ Public API ============

/**
 * Initialize the tags service. Called on app startup.
 * @deprecated Use initializeTagsWithData for unified scanning
 */
export async function initializeTagsService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        return;
    }

    // Try to load existing index
    const existingIndex = await loadIndexFromDisk();

    if (existingIndex) {
        // Refresh with incremental updates
        const { index: refreshedIndex, updated, removed } = await refreshIndex(existingIndex);
        index = refreshedIndex;
        if (updated > 0 || removed > 0) {
            await saveIndexToDisk(index);
        }
        console.log(`[Tags] Refreshed index: ${updated} updated, ${removed} removed`);
    } else {
        // Build fresh index
        index = await buildFullIndex();
        await saveIndexToDisk(index);
        const tagCount = Object.keys(index.tags).length;
        console.log(`[Tags] Built fresh index with ${tagCount} unique tags`);
    }
}

/**
 * Initialize tags from pre-scanned file data.
 * Used by unified indexer to avoid duplicate file scanning.
 */
export async function initializeTagsWithData(params: {
    files: FileIndexData[];
}): Promise<{ updated: number; total: number; tagCount: number }> {
    if (!hasActiveWorkspace()) {
        return { updated: 0, total: 0, tagCount: 0 };
    }

    const { files } = params;

    // Build file refs (notes:path or todos:path)
    const fileRefs = files.map((f) => `${f.source}:${f.relativePath}`);
    const existingFileRefs = StringSet.fromArray(fileRefs);

    // Try to load existing index for incremental update
    const existingIndex = await loadIndexFromDisk();

    if (existingIndex) {
        // Find what needs updating
        const needsUpdate: FileIndexData[] = [];
        const toRemove: string[] = [];

        for (const file of files) {
            const fileRef = `${file.source}:${file.relativePath}`;
            if (!existingIndex.mtimes[fileRef] || existingIndex.mtimes[fileRef] !== file.mtime) {
                needsUpdate.push(file);
            }
        }

        // Find deleted files
        for (const fileRef of Object.keys(existingIndex.mtimes)) {
            if (!StringSet.has(existingFileRefs, fileRef)) {
                toRemove.push(fileRef);
            }
        }

        // Apply removals
        for (const fileRef of toRemove) {
            removeFileFromIndex({ indexRef: existingIndex, fileName: fileRef });
        }

        // Apply updates using pre-extracted tags
        for (const file of needsUpdate) {
            const fileRef = `${file.source}:${file.relativePath}`;
            existingIndex.mtimes[fileRef] = file.mtime;
            updateFileInIndexWithTags({
                indexRef: existingIndex,
                fileName: fileRef,
                tags: file.tags,
            });
        }

        existingIndex.lastFullScan = new Date().toISOString();
        index = existingIndex;

        if (needsUpdate.length > 0 || toRemove.length > 0) {
            await saveIndexToDisk(index);
        }

        return {
            updated: needsUpdate.length,
            total: files.length,
            tagCount: Object.keys(index.tags).length,
        };
    } else {
        // Build fresh index from pre-scanned data
        const newIndex = createEmptyTagsIndex();

        for (const file of files) {
            const fileRef = `${file.source}:${file.relativePath}`;
            newIndex.mtimes[fileRef] = file.mtime;
            updateFileInIndexWithTags({
                indexRef: newIndex,
                fileName: fileRef,
                tags: file.tags,
            });
        }

        newIndex.lastFullScan = new Date().toISOString();
        index = newIndex;
        await saveIndexToDisk(index);

        return {
            updated: files.length,
            total: files.length,
            tagCount: Object.keys(index.tags).length,
        };
    }
}

/**
 * Update index for a file using pre-extracted tags.
 */
function updateFileInIndexWithTags(params: {
    indexRef: TagsIndex;
    fileName: string;
    tags: string[];
}): void {
    const { indexRef, fileName, tags } = params;

    // 1. Remove old tags for this file
    const oldTags = indexRef.fileTags[fileName];
    if (oldTags) {
        for (const tag of Object.keys(oldTags)) {
            if (indexRef.tags[tag]) {
                StringSet.remove(indexRef.tags[tag], fileName);
                if (StringSet.isEmpty(indexRef.tags[tag])) {
                    delete indexRef.tags[tag];
                }
            }
        }
    }

    // 2. Update fileTags index
    if (tags.length > 0) {
        indexRef.fileTags[fileName] = StringSet.fromArray(tags);
    } else {
        delete indexRef.fileTags[fileName];
    }

    // 3. Update tags index
    for (const tag of tags) {
        if (!indexRef.tags[tag]) {
            indexRef.tags[tag] = StringSet.create();
        }
        StringSet.add(indexRef.tags[tag], fileName);
    }
}

/**
 * Get all tags for autocomplete, sorted by usage count
 */
export function getAllTags(): TagSuggestion[] {
    if (!index) {
        return [];
    }

    return Object.entries(index.tags)
        .map(([tag, files]) => ({
            tag,
            count: StringSet.size(files),
        }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Search tags by prefix for autocomplete
 */
export function searchTags(params: { query: string }): TagSuggestion[] {
    if (!index) {
        return [];
    }

    const query = params.query.toLowerCase();

    return Object.entries(index.tags)
        .filter(([tag]) => tag.startsWith(query))
        .map(([tag, files]) => ({
            tag,
            count: StringSet.size(files),
        }))
        .sort((a, b) => {
            // Exact match first, then by count
            if (a.tag === query) return -1;
            if (b.tag === query) return 1;
            return b.count - a.count;
        })
        .slice(0, 20); // Limit results
}

/**
 * Get tags for a specific file (from notes directory)
 */
export function getTagsForFile(params: { fileName: string }): string[] {
    if (!index) {
        return [];
    }

    // Add notes: prefix for lookup
    const fileRef = `notes:${params.fileName}`;
    const fileTags = index.fileTags[fileRef];
    return fileTags ? StringSet.toArray(fileTags) : [];
}

/**
 * Get files that use a specific tag
 */
export function getFilesWithTag(params: { tag: string }): string[] {
    if (!index) {
        return [];
    }

    const tagFiles = index.tags[params.tag.toLowerCase()];
    return tagFiles ? StringSet.toArray(tagFiles) : [];
}

/**
 * Update index when a note is saved (from notes directory)
 */
export async function onNoteSavedTags(params: {
    fileName: string;
    content: string;
}): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    const { fileName, content } = params;
    // Add notes: prefix for index operations
    const fileRef = `notes:${fileName}`;

    // Update mtime
    try {
        index.mtimes[fileRef] = await getFileMtime(fileRef);
    } catch {
        // File might not exist yet, use current time
        index.mtimes[fileRef] = Date.now();
    }

    updateFileInIndex({
        indexRef: index,
        fileName: fileRef,
        content,
    });

    await saveIndexToDisk(index);
}

/**
 * Update index when a note is deleted (from notes directory)
 */
export async function onNoteDeletedTags(params: { fileName: string }): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    // Add notes: prefix for index operations
    const fileRef = `notes:${params.fileName}`;
    removeFileFromIndex({ indexRef: index, fileName: fileRef });
    await saveIndexToDisk(index);
}

/**
 * Update index when a note is renamed (from notes directory)
 */
export async function onNoteRenamedTags(params: {
    oldFileName: string;
    newFileName: string;
}): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    // Add notes: prefix for index operations
    const oldFileRef = `notes:${params.oldFileName}`;
    const newFileRef = `notes:${params.newFileName}`;

    // Copy tags from old file to new file
    if (index.fileTags[oldFileRef]) {
        index.fileTags[newFileRef] = index.fileTags[oldFileRef];
        delete index.fileTags[oldFileRef];
    }

    // Update all tag entries
    for (const tag of Object.keys(index.tags)) {
        const files = index.tags[tag];
        if (StringSet.has(files, oldFileRef)) {
            StringSet.remove(files, oldFileRef);
            StringSet.add(files, newFileRef);
        }
    }

    // Update mtimes
    if (index.mtimes[oldFileRef]) {
        index.mtimes[newFileRef] = index.mtimes[oldFileRef];
        delete index.mtimes[oldFileRef];
    }

    await saveIndexToDisk(index);
}

/**
 * Force rebuild the entire index
 */
export async function rebuildTagsIndex(): Promise<{ tagCount: number }> {
    if (!hasActiveWorkspace()) {
        return { tagCount: 0 };
    }

    index = await buildFullIndex();
    await saveIndexToDisk(index);
    return { tagCount: Object.keys(index.tags).length };
}

/**
 * Get the current index (for debugging)
 */
export function getTagsIndex(): TagsIndex | null {
    return index;
}
