/**
 * Tags Index Types
 *
 * Stores all tags used across notes for quick autocomplete.
 * Uses Record<string, true> as a JSON-serializable Set for O(1) operations.
 */

import { StringSet } from "./backlinks-types";

// Explicit tag definition with optional metadata
export interface ExplicitTagDefinition {
    name: string; // Tag name without #
    createdAt: string; // ISO timestamp
    // Future: color, description, etc.
}

// The persisted index structure
export interface TagsIndex {
    version: 1;
    lastFullScan: string; // ISO timestamp

    // All unique tags across the vault
    // Key: tag name (without #), Value: set of filenames using this tag
    tags: Record<string, StringSet>;

    // Reverse index: file → tags it contains
    // Key: filename, Value: set of tags in that file
    fileTags: Record<string, StringSet>;

    // File modification times for incremental updates
    // Key: filename, Value: mtime in ms
    mtimes: Record<string, number>;

    // User-defined explicit tags (persist even when unused)
    // Key: tag name (without #), Value: tag definition
    explicitTags?: Record<string, ExplicitTagDefinition>;
}

// Query result for autocomplete
export interface TagSuggestion {
    tag: string; // Tag name without #
    count: number; // Number of notes using this tag
}

// Create an empty index
export function createEmptyTagsIndex(): TagsIndex {
    return {
        version: 1,
        lastFullScan: new Date().toISOString(),
        tags: {},
        fileTags: {},
        mtimes: {},
        explicitTags: {},
    };
}
