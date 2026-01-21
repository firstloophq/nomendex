/**
 * File Scanner Utility
 *
 * Scans directories for markdown files, filtering out online-only cloud files.
 * Used by backlinks and tags services to avoid duplicate scanning.
 */

import { stat } from "node:fs/promises";
import { join } from "path";
import { startupLog } from "@/lib/logger";
import { getNotesPath, getTodosPath, hasActiveWorkspace } from "@/storage/root-path";

export interface ScannedFile {
    /** Relative path from source directory */
    relativePath: string;
    /** Full absolute path */
    fullPath: string;
    /** Source directory type */
    source: "notes" | "todos";
    /** File modification time */
    mtime: number;
    /** File content (populated after reading) */
    content?: string;
}

export interface ScanResult {
    files: ScannedFile[];
    skippedOnlineOnly: number;
    skippedErrors: number;
}

/**
 * Check if a file is online-only (cloud placeholder without local data).
 * Online-only files have size > 0 but blocks === 0.
 */
async function isOnlineOnly(filePath: string): Promise<boolean> {
    try {
        const stats = await stat(filePath);
        return stats.size > 0 && stats.blocks === 0;
    } catch {
        return false; // If we can't stat it, let the read fail later
    }
}

/**
 * Scan a directory for markdown files, excluding online-only files.
 */
async function scanDirectory(params: {
    dirPath: string;
    source: "notes" | "todos";
}): Promise<{ files: ScannedFile[]; skippedOnlineOnly: number; skippedErrors: number }> {
    const { dirPath, source } = params;
    const files: ScannedFile[] = [];
    let skippedOnlineOnly = 0;
    let skippedErrors = 0;

    const glob = new Bun.Glob("**/*.md");

    for await (const relativePath of glob.scan({ cwd: dirPath })) {
        const fullPath = join(dirPath, relativePath);

        try {
            // Check if file is online-only
            if (await isOnlineOnly(fullPath)) {
                skippedOnlineOnly++;
                continue;
            }

            // Get mtime
            const stats = await stat(fullPath);

            files.push({
                relativePath,
                fullPath,
                source,
                mtime: stats.mtime.getTime(),
            });
        } catch (error) {
            skippedErrors++;
            startupLog.warn(`Failed to stat file: ${fullPath}`, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return { files, skippedOnlineOnly, skippedErrors };
}

/**
 * Scan all markdown files in notes and todos directories.
 * Filters out online-only cloud files.
 */
export async function scanAllFiles(): Promise<ScanResult> {
    if (!hasActiveWorkspace()) {
        return { files: [], skippedOnlineOnly: 0, skippedErrors: 0 };
    }

    const notesPath = getNotesPath();
    const todosPath = getTodosPath();

    // Scan both directories
    const [notesResult, todosResult] = await Promise.all([
        scanDirectory({ dirPath: notesPath, source: "notes" }),
        scanDirectory({ dirPath: todosPath, source: "todos" }),
    ]);

    return {
        files: [...notesResult.files, ...todosResult.files],
        skippedOnlineOnly: notesResult.skippedOnlineOnly + todosResult.skippedOnlineOnly,
        skippedErrors: notesResult.skippedErrors + todosResult.skippedErrors,
    };
}

/**
 * Scan only the notes directory (for backlinks which don't need todos).
 */
export async function scanNotesFiles(): Promise<ScanResult> {
    if (!hasActiveWorkspace()) {
        return { files: [], skippedOnlineOnly: 0, skippedErrors: 0 };
    }

    const notesPath = getNotesPath();
    return scanDirectory({ dirPath: notesPath, source: "notes" });
}

/**
 * Read content for a list of scanned files.
 * Populates the `content` field on each file.
 */
export async function readFileContents(files: ScannedFile[]): Promise<void> {
    for (const file of files) {
        try {
            file.content = await Bun.file(file.fullPath).text();
        } catch (error) {
            startupLog.warn(`Failed to read file: ${file.fullPath}`, {
                error: error instanceof Error ? error.message : String(error),
            });
            file.content = ""; // Empty content so extractors don't fail
        }
    }
}

/**
 * Get a file reference string for index storage.
 * Format: "notes:path/to/file.md" or "todos:path/to/file.md"
 */
export function getFileRef(file: ScannedFile): string {
    return `${file.source}:${file.relativePath}`;
}

/**
 * Parse a file reference string back to source and path.
 */
export function parseFileRef(fileRef: string): { source: "notes" | "todos"; path: string } {
    if (fileRef.startsWith("notes:")) {
        return { source: "notes", path: fileRef.slice(6) };
    } else if (fileRef.startsWith("todos:")) {
        return { source: "todos", path: fileRef.slice(6) };
    }
    // Default to notes for backwards compatibility
    return { source: "notes", path: fileRef };
}
