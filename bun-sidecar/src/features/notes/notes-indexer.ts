/**
 * Notes Indexer
 *
 * Unified indexer that scans files once and extracts both wiki links and tags.
 * Provides data to backlinks and tags services.
 */

import { startupLog } from "@/lib/logger";
import { hasActiveWorkspace } from "@/storage/root-path";
import { scanNotesFiles, scanAllFiles, readFileContents, getFileRef, type ScannedFile } from "./file-scanner";
import { extractWikiLinks } from "./backlinks-service";
import { extractTags } from "./tags-service";

export interface FileIndexData {
    /** File reference (e.g., "notes:path/to/file.md") */
    fileRef: string;
    /** Relative path */
    relativePath: string;
    /** Source directory */
    source: "notes" | "todos";
    /** File modification time */
    mtime: number;
    /** Extracted wiki links (for backlinks) */
    wikiLinks: string[];
    /** Extracted tags (for tags index) */
    tags: string[];
}

export interface IndexScanResult {
    /** Indexed file data */
    files: FileIndexData[];
    /** Number of online-only files skipped */
    skippedOnlineOnly: number;
    /** Number of files that errored */
    skippedErrors: number;
}

/**
 * Scan and extract index data from all files.
 * Used for building fresh indexes.
 *
 * @param includeBacklinks - If true, scans only notes dir. If false, scans notes + todos.
 */
export async function scanAndExtractAll(params: {
    notesOnly: boolean;
}): Promise<IndexScanResult> {
    if (!hasActiveWorkspace()) {
        return { files: [], skippedOnlineOnly: 0, skippedErrors: 0 };
    }

    const { notesOnly } = params;

    // Scan files (filtering out online-only)
    startupLog.info("Scanning files...");
    const scanResult = notesOnly
        ? await scanNotesFiles()
        : await scanAllFiles();

    if (scanResult.skippedOnlineOnly > 0) {
        startupLog.info(`Skipped ${scanResult.skippedOnlineOnly} online-only files`);
    }
    if (scanResult.skippedErrors > 0) {
        startupLog.warn(`Failed to stat ${scanResult.skippedErrors} files`);
    }

    startupLog.info(`Found ${scanResult.files.length} files to index`);

    // Read all file contents
    startupLog.info("Reading file contents...");
    await readFileContents(scanResult.files);

    // Extract wiki links and tags from each file
    startupLog.info("Extracting links and tags...");
    const indexedFiles: FileIndexData[] = scanResult.files.map((file) => ({
        fileRef: getFileRef(file),
        relativePath: file.relativePath,
        source: file.source,
        mtime: file.mtime,
        wikiLinks: extractWikiLinks(file.content || ""),
        tags: extractTags(file.content || ""),
    }));

    return {
        files: indexedFiles,
        skippedOnlineOnly: scanResult.skippedOnlineOnly,
        skippedErrors: scanResult.skippedErrors,
    };
}

/**
 * Check which files need updating based on mtimes.
 * Returns files that are new or modified.
 */
export async function findModifiedFiles(params: {
    existingMtimes: Record<string, number>;
    notesOnly: boolean;
}): Promise<{
    toUpdate: ScannedFile[];
    toRemove: string[];
    skippedOnlineOnly: number;
    skippedErrors: number;
}> {
    const { existingMtimes, notesOnly } = params;

    // Scan files
    const scanResult = notesOnly
        ? await scanNotesFiles()
        : await scanAllFiles();

    const currentFileRefs = new Set<string>();
    const toUpdate: ScannedFile[] = [];

    for (const file of scanResult.files) {
        const fileRef = getFileRef(file);
        currentFileRefs.add(fileRef);

        // Check if new or modified
        if (!existingMtimes[fileRef] || existingMtimes[fileRef] !== file.mtime) {
            toUpdate.push(file);
        }
    }

    // Find deleted files
    const toRemove: string[] = [];
    for (const fileRef of Object.keys(existingMtimes)) {
        if (!currentFileRefs.has(fileRef)) {
            toRemove.push(fileRef);
        }
    }

    return {
        toUpdate,
        toRemove,
        skippedOnlineOnly: scanResult.skippedOnlineOnly,
        skippedErrors: scanResult.skippedErrors,
    };
}

/**
 * Read and extract data from specific files.
 */
export async function extractFromFiles(files: ScannedFile[]): Promise<FileIndexData[]> {
    await readFileContents(files);

    return files.map((file) => ({
        fileRef: getFileRef(file),
        relativePath: file.relativePath,
        source: file.source,
        mtime: file.mtime,
        wikiLinks: extractWikiLinks(file.content || ""),
        tags: extractTags(file.content || ""),
    }));
}
