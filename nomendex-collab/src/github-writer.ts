/**
 * GitHubWriter: Handles writing Y.js materialized files to a GitHub repository.
 * Uses the GitHub Git Data API for atomic multi-file commits.
 *
 * Phase 1: Stub interface only.
 * Phase 4: Full implementation with debounced commit scheduling.
 */

export interface GitHubConnection {
    owner: string;
    repo: string;
    branch: string;
    token: string;
}

export interface FileChange {
    path: string;
    content: string | null; // null = deletion
}

export interface CommitResult {
    sha: string;
    url: string;
    filesChanged: number;
}

/**
 * Commit a batch of file changes to GitHub atomically.
 * Uses Git Data API: create blobs -> create tree -> create commit -> update ref.
 */
export async function commitChanges(_params: {
    connection: GitHubConnection;
    changes: FileChange[];
    message: string;
}): Promise<CommitResult> {
    // Phase 4 implementation
    throw new Error("GitHub writer not yet implemented. Coming in Phase 4.");
}
