/**
 * Backlinks Service
 *
 * Manages the backlinks index for wiki-style [[links]] between notes.
 * Index is stored at {workspace}/.nomendex/backlinks.json
 */

import { mkdir } from "node:fs/promises";
import { join } from "path";
import { getNomendexPath, getNotesPath, hasActiveWorkspace } from "@/storage/root-path";
import {
    BacklinksIndex,
    BacklinksResult,
    StringSet,
    createEmptyIndex,
} from "./backlinks-types";
import type { FileIndexData } from "./notes-indexer";

// In-memory index for fast queries
let index: BacklinksIndex | null = null;

// Regex to extract [[wiki links]] from markdown
const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Extract wiki links from markdown content
 */
export function extractWikiLinks(content: string): string[] {
    const links: string[] = [];
    let match;
    // Reset regex state
    WIKI_LINK_REGEX.lastIndex = 0;
    while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
        const linkTarget = match[1];
        if (linkTarget) {
            links.push(linkTarget.trim());
        }
    }
    // Dedupe
    return [...new Set(links)];
}

/**
 * Get the path to the backlinks index file
 */
function getIndexPath(): string {
    return join(getNomendexPath(), "backlinks.json");
}

/**
 * Load the index from disk
 */
async function loadIndexFromDisk(): Promise<BacklinksIndex | null> {
    try {
        const indexPath = getIndexPath();
        const file = Bun.file(indexPath);
        if (!(await file.exists())) {
            return null;
        }
        const content = await file.text();
        return JSON.parse(content) as BacklinksIndex;
    } catch {
        return null;
    }
}

/**
 * Save the index to disk
 */
async function saveIndexToDisk(indexToSave: BacklinksIndex): Promise<void> {
    const nomendexPath = getNomendexPath();
    await mkdir(nomendexPath, { recursive: true });
    const indexPath = getIndexPath();
    await Bun.write(indexPath, JSON.stringify(indexToSave, null, 2));
}

/**
 * Get all .md files in the notes directory recursively
 */
async function getAllNoteFiles(): Promise<string[]> {
    const notesPath = getNotesPath();
    const glob = new Bun.Glob("**/*.md");
    const files: string[] = [];
    for await (const file of glob.scan({ cwd: notesPath })) {
        files.push(file);
    }
    return files;
}

/**
 * Get file modification time
 */
async function getFileMtime(fileName: string): Promise<number> {
    const notesPath = getNotesPath();
    const filePath = join(notesPath, fileName);
    const file = Bun.file(filePath);
    const stat = await file.stat();
    return stat.mtime.getTime();
}

/**
 * Read file content
 */
async function readFileContent(fileName: string): Promise<string> {
    const notesPath = getNotesPath();
    const filePath = join(notesPath, fileName);
    return await Bun.file(filePath).text();
}

/**
 * Update index for a single file - O(L_old + M + L_new)
 */
function updateFileInIndex(params: {
    indexRef: BacklinksIndex;
    fileName: string;
    content: string;
    existingFiles: StringSet;
}): void {
    const { indexRef, fileName, content, existingFiles } = params;
    const fileNameWithoutExt = fileName.replace(/\.md$/, "");

    // 1. Remove old outbound links for this file - O(L_old)
    const oldLinks = indexRef.outboundLinks[fileName];
    if (oldLinks) {
        for (const target of Object.keys(oldLinks)) {
            // Remove from backlinks
            if (indexRef.backlinks[target]) {
                StringSet.remove(indexRef.backlinks[target], fileName);
                if (StringSet.isEmpty(indexRef.backlinks[target])) {
                    delete indexRef.backlinks[target];
                }
            }
            // Remove from phantoms
            if (indexRef.phantoms[target]) {
                StringSet.remove(indexRef.phantoms[target], fileName);
                if (StringSet.isEmpty(indexRef.phantoms[target])) {
                    delete indexRef.phantoms[target];
                }
            }
        }
    }

    // 2. Extract new links - O(M)
    const newLinks = extractWikiLinks(content);

    // 3. Add new outbound links - O(L_new)
    if (newLinks.length > 0) {
        indexRef.outboundLinks[fileName] = StringSet.fromArray(newLinks);
    } else {
        delete indexRef.outboundLinks[fileName];
    }

    // 4. Update backlinks and phantoms - O(L_new)
    for (const target of newLinks) {
        // Add to backlinks
        if (!indexRef.backlinks[target]) {
            indexRef.backlinks[target] = StringSet.create();
        }
        StringSet.add(indexRef.backlinks[target], fileName);

        // Check if this is a phantom (target doesn't exist)
        const targetFile = `${target}.md`;
        const targetFileLower = targetFile.toLowerCase();

        // Check case-insensitively
        let targetExists = false;
        for (const existing of Object.keys(existingFiles)) {
            if (existing.toLowerCase() === targetFileLower) {
                targetExists = true;
                break;
            }
        }

        if (!targetExists) {
            if (!indexRef.phantoms[target]) {
                indexRef.phantoms[target] = StringSet.create();
            }
            StringSet.add(indexRef.phantoms[target], fileName);
        }
    }

    // 5. If this file was a phantom target, it's no longer phantom
    // Check case-insensitively
    for (const phantomKey of Object.keys(indexRef.phantoms)) {
        if (phantomKey.toLowerCase() === fileNameWithoutExt.toLowerCase()) {
            delete indexRef.phantoms[phantomKey];
        }
    }
}

/**
 * Remove file from index - O(L)
 */
function removeFileFromIndex(params: {
    indexRef: BacklinksIndex;
    fileName: string;
}): void {
    const { indexRef, fileName } = params;

    // Remove all outbound links
    const oldLinks = indexRef.outboundLinks[fileName];
    if (oldLinks) {
        for (const target of Object.keys(oldLinks)) {
            if (indexRef.backlinks[target]) {
                StringSet.remove(indexRef.backlinks[target], fileName);
                if (StringSet.isEmpty(indexRef.backlinks[target])) {
                    delete indexRef.backlinks[target];
                }
            }
            if (indexRef.phantoms[target]) {
                StringSet.remove(indexRef.phantoms[target], fileName);
                if (StringSet.isEmpty(indexRef.phantoms[target])) {
                    delete indexRef.phantoms[target];
                }
            }
        }
    }

    delete indexRef.outboundLinks[fileName];
    delete indexRef.mtimes[fileName];
}

/**
 * Build a full index from scratch
 */
async function buildFullIndex(): Promise<BacklinksIndex> {
    const newIndex = createEmptyIndex();
    const files = await getAllNoteFiles();
    const existingFiles = StringSet.fromArray(files);

    for (const file of files) {
        const content = await readFileContent(file);
        const mtime = await getFileMtime(file);
        newIndex.mtimes[file] = mtime;
        updateFileInIndex({
            indexRef: newIndex,
            fileName: file,
            content,
            existingFiles,
        });
    }

    newIndex.lastFullScan = new Date().toISOString();
    return newIndex;
}

/**
 * Refresh index - only update modified files
 */
async function refreshIndex(currentIndex: BacklinksIndex): Promise<{
    index: BacklinksIndex;
    updated: number;
    removed: number;
}> {
    const files = await getAllNoteFiles();
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
            existingFiles,
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
 * Initialize the backlinks service. Called on app startup.
 * @deprecated Use initializeBacklinksWithData for unified scanning
 */
export async function initializeBacklinksService(): Promise<void> {
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
        console.log(`[Backlinks] Refreshed index: ${updated} updated, ${removed} removed`);
    } else {
        // Build fresh index
        index = await buildFullIndex();
        await saveIndexToDisk(index);
        console.log(`[Backlinks] Built fresh index with ${Object.keys(index.mtimes).length} files`);
    }
}

/**
 * Initialize backlinks from pre-scanned file data.
 * Used by unified indexer to avoid duplicate file scanning.
 */
export async function initializeBacklinksWithData(params: {
    files: FileIndexData[];
}): Promise<{ updated: number; total: number }> {
    if (!hasActiveWorkspace()) {
        return { updated: 0, total: 0 };
    }

    const { files } = params;

    // Filter to notes only (backlinks doesn't use todos)
    const notesFiles = files.filter((f) => f.source === "notes");

    // Try to load existing index for incremental update
    const existingIndex = await loadIndexFromDisk();
    const existingFiles = StringSet.fromArray(notesFiles.map((f) => f.relativePath));

    if (existingIndex) {
        // Find what needs updating
        const needsUpdate: FileIndexData[] = [];
        const toRemove: string[] = [];

        for (const file of notesFiles) {
            if (!existingIndex.mtimes[file.relativePath] || existingIndex.mtimes[file.relativePath] !== file.mtime) {
                needsUpdate.push(file);
            }
        }

        // Find deleted files
        for (const fileName of Object.keys(existingIndex.mtimes)) {
            if (!StringSet.has(existingFiles, fileName)) {
                toRemove.push(fileName);
            }
        }

        // Apply removals
        for (const fileName of toRemove) {
            removeFileFromIndex({ indexRef: existingIndex, fileName });
        }

        // Apply updates using pre-extracted wiki links
        for (const file of needsUpdate) {
            existingIndex.mtimes[file.relativePath] = file.mtime;
            updateFileInIndexWithLinks({
                indexRef: existingIndex,
                fileName: file.relativePath,
                wikiLinks: file.wikiLinks,
                existingFiles,
            });
        }

        existingIndex.lastFullScan = new Date().toISOString();
        index = existingIndex;

        if (needsUpdate.length > 0 || toRemove.length > 0) {
            await saveIndexToDisk(index);
        }

        return { updated: needsUpdate.length, total: notesFiles.length };
    } else {
        // Build fresh index from pre-scanned data
        const newIndex = createEmptyIndex();

        for (const file of notesFiles) {
            newIndex.mtimes[file.relativePath] = file.mtime;
            updateFileInIndexWithLinks({
                indexRef: newIndex,
                fileName: file.relativePath,
                wikiLinks: file.wikiLinks,
                existingFiles,
            });
        }

        newIndex.lastFullScan = new Date().toISOString();
        index = newIndex;
        await saveIndexToDisk(index);

        return { updated: notesFiles.length, total: notesFiles.length };
    }
}

/**
 * Update index for a file using pre-extracted wiki links.
 */
function updateFileInIndexWithLinks(params: {
    indexRef: BacklinksIndex;
    fileName: string;
    wikiLinks: string[];
    existingFiles: StringSet;
}): void {
    const { indexRef, fileName, wikiLinks, existingFiles } = params;
    const fileNameWithoutExt = fileName.replace(/\.md$/, "");

    // 1. Remove old outbound links for this file
    const oldLinks = indexRef.outboundLinks[fileName];
    if (oldLinks) {
        for (const target of Object.keys(oldLinks)) {
            if (indexRef.backlinks[target]) {
                StringSet.remove(indexRef.backlinks[target], fileName);
                if (StringSet.isEmpty(indexRef.backlinks[target])) {
                    delete indexRef.backlinks[target];
                }
            }
            if (indexRef.phantoms[target]) {
                StringSet.remove(indexRef.phantoms[target], fileName);
                if (StringSet.isEmpty(indexRef.phantoms[target])) {
                    delete indexRef.phantoms[target];
                }
            }
        }
    }

    // 2. Add new outbound links
    if (wikiLinks.length > 0) {
        indexRef.outboundLinks[fileName] = StringSet.fromArray(wikiLinks);
    } else {
        delete indexRef.outboundLinks[fileName];
    }

    // 3. Update backlinks and phantoms
    for (const target of wikiLinks) {
        if (!indexRef.backlinks[target]) {
            indexRef.backlinks[target] = StringSet.create();
        }
        StringSet.add(indexRef.backlinks[target], fileName);

        // Check if this is a phantom (target doesn't exist)
        const targetFile = `${target}.md`;
        const targetFileLower = targetFile.toLowerCase();

        let targetExists = false;
        for (const existing of Object.keys(existingFiles)) {
            if (existing.toLowerCase() === targetFileLower) {
                targetExists = true;
                break;
            }
        }

        if (!targetExists) {
            if (!indexRef.phantoms[target]) {
                indexRef.phantoms[target] = StringSet.create();
            }
            StringSet.add(indexRef.phantoms[target], fileName);
        }
    }

    // 4. If this file was a phantom target, it's no longer phantom
    for (const phantomKey of Object.keys(indexRef.phantoms)) {
        if (phantomKey.toLowerCase() === fileNameWithoutExt.toLowerCase()) {
            delete indexRef.phantoms[phantomKey];
        }
    }
}

/**
 * Get backlinks for a specific note
 */
export function getBacklinksForNote(params: { fileName: string }): BacklinksResult {
    if (!index) {
        return { backlinks: [], phantomLinks: [] };
    }

    const { fileName } = params;
    const noteNameWithoutExt = fileName.replace(/\.md$/, "");

    // Get backlinks - check both with and without extension
    const backlinksSet = index.backlinks[noteNameWithoutExt];
    const backlinks: BacklinksResult["backlinks"] = [];

    if (backlinksSet) {
        for (const sourceFile of StringSet.toArray(backlinksSet)) {
            // Generate display name (remove path and extension)
            const parts = sourceFile.replace(/\.md$/, "").split("/");
            const displayName = parts[parts.length - 1] || sourceFile;
            backlinks.push({ sourceFile, displayName });
        }
    }

    // Get phantom links that reference this note's outbound links
    const outbound = index.outboundLinks[fileName];
    const phantomLinks: BacklinksResult["phantomLinks"] = [];

    if (outbound) {
        for (const target of Object.keys(outbound)) {
            if (index.phantoms[target]) {
                phantomLinks.push({
                    targetName: target,
                    referencedIn: StringSet.toArray(index.phantoms[target]),
                });
            }
        }
    }

    return { backlinks, phantomLinks };
}

/**
 * Get all phantom links in the vault
 */
export function getAllPhantomLinks(): Array<{
    targetName: string;
    referencedIn: string[];
}> {
    if (!index) {
        return [];
    }

    return Object.entries(index.phantoms).map(([target, sources]) => ({
        targetName: target,
        referencedIn: StringSet.toArray(sources),
    }));
}

/**
 * Update index when a note is saved
 */
export async function onNoteSaved(params: {
    fileName: string;
    content: string;
}): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    const { fileName, content } = params;
    const files = await getAllNoteFiles();
    const existingFiles = StringSet.fromArray(files);

    // Update mtime
    try {
        index.mtimes[fileName] = await getFileMtime(fileName);
    } catch {
        // File might not exist yet, use current time
        index.mtimes[fileName] = Date.now();
    }

    updateFileInIndex({
        indexRef: index,
        fileName,
        content,
        existingFiles,
    });

    await saveIndexToDisk(index);
}

/**
 * Update index when a note is deleted
 */
export async function onNoteDeleted(params: { fileName: string }): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    const { fileName } = params;
    const fileNameWithoutExt = fileName.replace(/\.md$/, "");

    removeFileFromIndex({ indexRef: index, fileName });

    // This note is now a phantom if anything links to it
    if (index.backlinks[fileNameWithoutExt]) {
        const sources = StringSet.toArray(index.backlinks[fileNameWithoutExt]);
        index.phantoms[fileNameWithoutExt] = StringSet.fromArray(sources);
    }

    await saveIndexToDisk(index);
}

/**
 * Update index when a note is renamed
 */
export async function onNoteRenamed(params: {
    oldFileName: string;
    newFileName: string;
}): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    const { oldFileName, newFileName } = params;
    const oldNameWithoutExt = oldFileName.replace(/\.md$/, "");
    const newNameWithoutExt = newFileName.replace(/\.md$/, "");

    // 1. Update outboundLinks key
    if (index.outboundLinks[oldFileName]) {
        index.outboundLinks[newFileName] = index.outboundLinks[oldFileName];
        delete index.outboundLinks[oldFileName];
    }

    // 2. Update backlinks that reference the old name
    // Files that linked to oldName now link to... still the same target string
    // But the SOURCE file name changed
    for (const target of Object.keys(index.backlinks)) {
        const sources = index.backlinks[target];
        if (StringSet.has(sources, oldFileName)) {
            StringSet.remove(sources, oldFileName);
            StringSet.add(sources, newFileName);
        }
    }

    // 3. Update phantoms sources
    for (const target of Object.keys(index.phantoms)) {
        const sources = index.phantoms[target];
        if (StringSet.has(sources, oldFileName)) {
            StringSet.remove(sources, oldFileName);
            StringSet.add(sources, newFileName);
        }
    }

    // 4. If something was linking to oldName, update the backlinks key
    if (index.backlinks[oldNameWithoutExt]) {
        index.backlinks[newNameWithoutExt] = index.backlinks[oldNameWithoutExt];
        delete index.backlinks[oldNameWithoutExt];
    }

    // 5. Update mtimes
    if (index.mtimes[oldFileName]) {
        index.mtimes[newFileName] = index.mtimes[oldFileName];
        delete index.mtimes[oldFileName];
    }

    // 6. If old name was a phantom, remove it (it's been renamed)
    if (index.phantoms[oldNameWithoutExt]) {
        delete index.phantoms[oldNameWithoutExt];
    }

    await saveIndexToDisk(index);
}

/**
 * Update index when a note is created (resolves phantom if applicable)
 */
export async function onNoteCreated(params: { fileName: string }): Promise<void> {
    if (!index || !hasActiveWorkspace()) {
        return;
    }

    const { fileName } = params;
    const nameWithoutExt = fileName.replace(/\.md$/, "");

    // If this was a phantom, it's now resolved
    // Check case-insensitively
    for (const phantomKey of Object.keys(index.phantoms)) {
        if (phantomKey.toLowerCase() === nameWithoutExt.toLowerCase()) {
            delete index.phantoms[phantomKey];
        }
    }

    await saveIndexToDisk(index);
}

/**
 * Force rebuild the entire index
 */
export async function rebuildIndex(): Promise<{ fileCount: number }> {
    if (!hasActiveWorkspace()) {
        return { fileCount: 0 };
    }

    index = await buildFullIndex();
    await saveIndexToDisk(index);
    return { fileCount: Object.keys(index.mtimes).length };
}

/**
 * Get the current index (for debugging)
 */
export function getIndex(): BacklinksIndex | null {
    return index;
}
