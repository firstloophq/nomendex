/**
 * Git operations wrapper using isomorphic-git
 *
 * This module provides a clean interface for git operations without
 * requiring the git CLI to be installed.
 */

import git, { ReadCommitResult } from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "node:fs";
import { createServiceLogger } from "./logger";

const logger = createServiceLogger("GIT");

// Default author for commits
const DEFAULT_AUTHOR = {
    name: "Nomendex",
    email: "sync@nomendex.app",
};

// Types for git operations
export interface CommitInfo {
    hash: string;
    message: string;
    author: string;
    date: string;
}

export interface FileChange {
    path: string;
    status: "added" | "modified" | "deleted" | "untracked";
}

export interface StatusResult {
    changedFiles: FileChange[];
    hasUncommittedChanges: boolean;
}

export interface FetchStatusResult {
    behindCount: number;
    aheadCount: number;
    incomingCommits: CommitInfo[];
    incomingFiles: Array<{ status: string; path: string }>;
}

export interface ConflictFile {
    path: string;
    status: "both_modified" | "deleted_by_us" | "deleted_by_them" | "both_added";
    resolved: boolean;
}

/**
 * Merge state tracked by Nomendex (since isomorphic-git doesn't create MERGE_HEAD)
 */
export interface MergeState {
    inProgress: boolean;
    oursRef: string;         // e.g., "main"
    theirsRef: string;       // e.g., "origin/main"
    theirsOid: string;       // The commit SHA we're merging in
    oursOid: string;         // The commit SHA of our branch before merge
    conflictFiles: string[]; // Files that had conflicts
    startedAt: string;       // ISO timestamp
}

const MERGE_STATE_FILE = "NOMENDEX_MERGE_STATE";

interface GitClientConfig {
    dir: string;
    author?: { name: string; email: string };
}

interface AuthConfig {
    token: string;
}

/**
 * Create a git client for a specific directory
 */
export function createGitClient(config: GitClientConfig) {
    const { dir, author = DEFAULT_AUTHOR } = config;

    // Helper to create onAuth callback
    const createOnAuth = (auth: AuthConfig) => () => ({
        username: auth.token,
    });

    return {
        /**
         * Initialize a new git repository
         */
        async init(): Promise<void> {
            logger.info("Initializing git repository", { dir });
            await git.init({ fs, dir });
            logger.info("Git repository initialized");
        },

        /**
         * Check if directory is a git repository
         */
        async isRepo(): Promise<boolean> {
            try {
                await git.findRoot({ fs, filepath: dir });
                return true;
            } catch {
                return false;
            }
        },

        /**
         * Get current branch name
         */
        async currentBranch(): Promise<string | undefined> {
            try {
                const branch = await git.currentBranch({ fs, dir });
                return branch ?? undefined;
            } catch {
                return undefined;
            }
        },

        /**
         * List all local branches
         */
        async listBranches(): Promise<string[]> {
            return await git.listBranches({ fs, dir });
        },

        /**
         * Create a new branch
         */
        async createBranch(name: string): Promise<void> {
            await git.branch({ fs, dir, ref: name });
        },

        /**
         * Checkout a branch
         */
        async checkout(ref: string): Promise<void> {
            await git.checkout({ fs, dir, ref });
        },

        /**
         * Get repository status
         */
        async status(): Promise<StatusResult> {
            const matrix = await git.statusMatrix({ fs, dir });
            const changedFiles: FileChange[] = [];

            for (const [filepath, head, workdir, stage] of matrix) {
                // Status matrix: [filepath, HEAD, WORKDIR, STAGE]
                // HEAD: 0 = absent, 1 = present
                // WORKDIR: 0 = absent, 1 = identical to HEAD, 2 = different
                // STAGE: 0 = absent, 1 = identical to HEAD, 2 = identical to WORKDIR, 3 = different from both

                // Untracked: not in HEAD, but present in workdir (not staged)
                if (head === 0 && workdir === 2 && stage === 0) {
                    changedFiles.push({ path: filepath, status: "untracked" });
                }
                // Added: not in HEAD, but staged
                else if (head === 0 && stage !== 0) {
                    changedFiles.push({ path: filepath, status: "added" });
                }
                // Deleted: in HEAD, but not in workdir
                else if (head === 1 && workdir === 0) {
                    changedFiles.push({ path: filepath, status: "deleted" });
                }
                // Modified: in HEAD, but different in workdir or stage
                else if (head === 1 && (workdir === 2 || stage === 2 || stage === 3)) {
                    changedFiles.push({ path: filepath, status: "modified" });
                }
            }

            return {
                changedFiles,
                hasUncommittedChanges: changedFiles.length > 0,
            };
        },

        /**
         * Get recent commits
         */
        async log(opts: { depth?: number } = {}): Promise<CommitInfo[]> {
            try {
                const commits = await git.log({ fs, dir, depth: opts.depth ?? 5 });
                return commits.map((c: ReadCommitResult) => ({
                    hash: c.oid.slice(0, 7),
                    message: c.commit.message.split("\n")[0] ?? "",
                    author: c.commit.author.name,
                    date: formatRelativeTime(c.commit.author.timestamp * 1000),
                }));
            } catch {
                return [];
            }
        },

        /**
         * Stage all changes (add new/modified, remove deleted)
         */
        async addAll(): Promise<void> {
            const matrix = await git.statusMatrix({ fs, dir });

            for (const [filepath, head, workdir] of matrix) {
                if (workdir === 0 && head === 1) {
                    // File was deleted
                    await git.remove({ fs, dir, filepath });
                } else if (workdir === 2) {
                    // File was added or modified
                    await git.add({ fs, dir, filepath });
                }
            }
        },

        /**
         * Check if there are staged changes
         */
        async hasStagedChanges(): Promise<boolean> {
            const matrix = await git.statusMatrix({ fs, dir });
            for (const [, head, , stage] of matrix) {
                if (stage !== head && stage !== 0) {
                    return true;
                }
            }
            return false;
        },

        /**
         * Create a commit
         */
        async commit(message: string): Promise<string> {
            const sha = await git.commit({
                fs,
                dir,
                message,
                author,
            });
            logger.info("Created commit", { sha: sha.slice(0, 7), message });
            return sha;
        },

        /**
         * Add a remote
         */
        async addRemote(name: string, url: string): Promise<void> {
            try {
                await git.addRemote({ fs, dir, remote: name, url });
            } catch (e) {
                // Remote might already exist, try to update it
                if (String(e).includes("already exists")) {
                    await git.deleteRemote({ fs, dir, remote: name });
                    await git.addRemote({ fs, dir, remote: name, url });
                } else {
                    throw e;
                }
            }
        },

        /**
         * Get remote URL
         */
        async getRemoteUrl(name: string): Promise<string | undefined> {
            try {
                const remotes = await git.listRemotes({ fs, dir });
                const remote = remotes.find((r) => r.remote === name);
                return remote?.url;
            } catch {
                return undefined;
            }
        },

        /**
         * Check if a remote exists
         */
        async hasRemote(name: string): Promise<boolean> {
            try {
                const remotes = await git.listRemotes({ fs, dir });
                return remotes.some((r) => r.remote === name);
            } catch {
                return false;
            }
        },

        /**
         * List remotes
         */
        async listRemotes(): Promise<Array<{ remote: string; url: string }>> {
            try {
                return await git.listRemotes({ fs, dir });
            } catch {
                return [];
            }
        },

        /**
         * Fetch from remote
         */
        async fetch(auth: AuthConfig, remote = "origin", ref?: string): Promise<void> {
            logger.info("Fetching from remote", { remote, ref });
            await git.fetch({
                fs,
                http,
                dir,
                remote,
                ref,
                singleBranch: !!ref,
                onAuth: createOnAuth(auth),
            });
            logger.info("Fetch completed");
        },

        /**
         * Pull from remote (fetch + merge) with proper conflict handling
         *
         * This uses fetch + merge instead of git.pull() to support abortOnConflict: false,
         * which writes conflict markers to files instead of aborting completely.
         */
        async pull(auth: AuthConfig, remote = "origin", ref?: string): Promise<{ hadConflicts: boolean; conflictFiles: string[] }> {
            logger.info("Pulling from remote", { remote, ref });

            const branch = ref ?? await this.currentBranch();
            if (!branch) {
                throw new Error("Not on any branch");
            }

            // Step 1: Fetch from remote
            await git.fetch({
                fs,
                http,
                dir,
                remote,
                ref: branch,
                singleBranch: true,
                onAuth: createOnAuth(auth),
            });
            logger.info("Fetch completed");

            // Get current HEAD oid before merge
            const oursOid = await git.resolveRef({ fs, dir, ref: "HEAD" });

            // Get the remote ref oid
            let theirsOid: string;
            try {
                theirsOid = await git.resolveRef({ fs, dir, ref: `${remote}/${branch}` });
            } catch {
                // Remote branch doesn't exist yet
                logger.info("Remote branch doesn't exist, nothing to merge");
                return { hadConflicts: false, conflictFiles: [] };
            }

            // Check if we're already up to date
            if (oursOid === theirsOid) {
                logger.info("Already up to date");
                return { hadConflicts: false, conflictFiles: [] };
            }

            // Step 2: Merge with abortOnConflict: false to get conflict markers
            try {
                await git.merge({
                    fs,
                    dir,
                    ours: branch,
                    theirs: `${remote}/${branch}`,
                    abortOnConflict: false,
                    author,
                });
                logger.info("Pull completed (fast-forward or clean merge)");
                return { hadConflicts: false, conflictFiles: [] };
            } catch (e) {
                const error = e as Error;
                logger.info("Merge error caught", {
                    name: error.name,
                    message: error.message,
                    data: (e as { data?: unknown }).data
                });

                // Check if this is a merge conflict error
                if (error.name === "MergeConflictError" || error.message?.includes("Merge conflict") || error.message?.includes("CONFLICT")) {
                    // Extract conflict files from the error
                    // isomorphic-git puts them in error.data as an array of file paths
                    let conflictFiles: string[] = [];

                    const errorData = (e as { data?: unknown }).data;
                    if (Array.isArray(errorData)) {
                        conflictFiles = errorData.filter((item): item is string => typeof item === "string");
                    }

                    // If no conflict files from error, scan the working directory for conflict markers
                    if (conflictFiles.length === 0) {
                        logger.info("No conflict files in error data, scanning for conflict markers");
                        const index = await git.listFiles({ fs, dir });
                        for (const filepath of index) {
                            if (await this.hasConflictMarkers(filepath)) {
                                conflictFiles.push(filepath);
                            }
                        }
                    }

                    logger.info("Merge conflict detected", { conflictFiles, errorName: error.name });

                    // Save merge state so we can complete the merge later
                    const mergeState: MergeState = {
                        inProgress: true,
                        oursRef: branch,
                        theirsRef: `${remote}/${branch}`,
                        oursOid,
                        theirsOid,
                        conflictFiles,
                        startedAt: new Date().toISOString(),
                    };
                    await this.saveMergeState(mergeState);

                    return { hadConflicts: true, conflictFiles };
                }

                // Re-throw other errors
                throw e;
            }
        },

        /**
         * Push to remote
         */
        async push(auth: AuthConfig, remote = "origin", ref?: string): Promise<void> {
            logger.info("Pushing to remote", { remote, ref });
            await git.push({
                fs,
                http,
                dir,
                remote,
                ref,
                onAuth: createOnAuth(auth),
            });
            logger.info("Push completed");
        },

        /**
         * Check if remote branch exists
         */
        async remoteBranchExists(auth: AuthConfig, remote: string, branch: string): Promise<boolean> {
            try {
                const url = await this.getRemoteUrl(remote);
                if (!url) return false;

                const refs = await git.listServerRefs({
                    http,
                    url,
                    prefix: `refs/heads/${branch}`,
                    onAuth: createOnAuth(auth),
                });
                return refs.length > 0;
            } catch (e) {
                logger.debug("Remote branch check failed", { error: String(e) });
                return false;
            }
        },

        /**
         * Get fetch status (ahead/behind counts)
         */
        async getFetchStatus(auth: AuthConfig, branch: string): Promise<FetchStatusResult> {
            const result: FetchStatusResult = {
                behindCount: 0,
                aheadCount: 0,
                incomingCommits: [],
                incomingFiles: [],
            };

            try {
                // Fetch latest
                await this.fetch(auth, "origin", branch);

                // Get local and remote commits
                const localCommits = await git.log({ fs, dir, ref: branch });
                let remoteCommits: ReadCommitResult[] = [];
                try {
                    remoteCommits = await git.log({ fs, dir, ref: `origin/${branch}` });
                } catch {
                    // Remote branch might not exist yet
                    return result;
                }

                const localOids = new Set(localCommits.map((c: ReadCommitResult) => c.oid));
                const remoteOids = new Set(remoteCommits.map((c: ReadCommitResult) => c.oid));

                // Commits in remote but not in local = behind
                const behind = remoteCommits.filter((c: ReadCommitResult) => !localOids.has(c.oid));
                result.behindCount = behind.length;
                result.incomingCommits = behind.map((c: ReadCommitResult) => ({
                    hash: c.oid.slice(0, 7),
                    message: c.commit.message.split("\n")[0] ?? "",
                    author: c.commit.author.name,
                    date: formatRelativeTime(c.commit.author.timestamp * 1000),
                }));

                // Commits in local but not in remote = ahead
                result.aheadCount = localCommits.filter((c: ReadCommitResult) => !remoteOids.has(c.oid)).length;

                // Get file changes if behind
                if (result.behindCount > 0 && localCommits.length > 0 && remoteCommits.length > 0) {
                    try {
                        const localTree = localCommits[0]?.oid;
                        const remoteTree = remoteCommits[0]?.oid;
                        if (localTree && remoteTree) {
                            const changes = await git.walk({
                                fs,
                                dir,
                                trees: [git.TREE({ ref: localTree }), git.TREE({ ref: remoteTree })],
                                map: async function (filepath, [local, remote]) {
                                    if (filepath === ".") return undefined;
                                    const localOid = local ? await local.oid() : null;
                                    const remoteOid = remote ? await remote.oid() : null;

                                    if (localOid !== remoteOid) {
                                        let status = "M";
                                        if (!localOid && remoteOid) status = "A";
                                        if (localOid && !remoteOid) status = "D";
                                        return { status, path: filepath };
                                    }
                                    return undefined;
                                },
                            });
                            result.incomingFiles = changes.filter(Boolean) as Array<{ status: string; path: string }>;
                        }
                    } catch (e) {
                        logger.debug("Failed to get incoming files", { error: String(e) });
                    }
                }
            } catch (e) {
                logger.error("Failed to get fetch status", { error: String(e) });
                throw e;
            }

            return result;
        },

        /**
         * Check if in merge conflict state
         * Checks both our custom merge state and the standard MERGE_HEAD
         */
        async hasMergeConflict(): Promise<boolean> {
            try {
                // Check our custom merge state first
                const state = await this.getMergeState();
                const hasCustomState = state?.inProgress ?? false;
                logger.info("Checking merge conflict - custom state", { hasCustomState, state: state ? JSON.stringify(state).slice(0, 200) : null });

                if (hasCustomState) {
                    return true;
                }

                // Also check standard MERGE_HEAD for compatibility
                const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
                const hasMergeHead = await Bun.file(mergeHeadPath).exists();
                logger.info("Checking merge conflict - MERGE_HEAD", { hasMergeHead, path: mergeHeadPath });

                return hasMergeHead;
            } catch (e) {
                logger.error("Error checking merge conflict", { error: String(e) });
                return false;
            }
        },

        /**
         * Get conflicting files
         * Uses our stored merge state and scans for conflict markers
         */
        async getConflictFiles(): Promise<ConflictFile[]> {
            const conflicts: ConflictFile[] = [];
            const seenPaths = new Set<string>();

            logger.info("Getting conflict files - starting");

            try {
                // First, check our merge state for known conflict files
                const mergeState = await this.getMergeState();
                logger.info("Getting conflict files - merge state", {
                    hasState: !!mergeState,
                    conflictFilesCount: mergeState?.conflictFiles?.length ?? 0
                });

                if (mergeState?.conflictFiles) {
                    for (const filepath of mergeState.conflictFiles) {
                        const hasMarkers = await this.hasConflictMarkers(filepath);
                        logger.info("Checking file from merge state", { filepath, hasMarkers });
                        conflicts.push({
                            path: filepath,
                            status: "both_modified",
                            resolved: !hasMarkers,
                        });
                        seenPaths.add(filepath);
                    }
                }

                // Also scan all tracked files for conflict markers
                // This catches files that might have been missed or manually created
                const index = await git.listFiles({ fs, dir });
                logger.info("Scanning tracked files for markers", { fileCount: index.length });
                let filesWithMarkers = 0;
                for (const filepath of index) {
                    if (!seenPaths.has(filepath)) {
                        const hasMarkers = await this.hasConflictMarkers(filepath);
                        if (hasMarkers) {
                            filesWithMarkers++;
                            logger.info("Found file with conflict markers", { filepath });
                            conflicts.push({
                                path: filepath,
                                status: "both_modified",
                                resolved: false,
                            });
                            seenPaths.add(filepath);
                        }
                    }
                }
                logger.info("Finished scanning for markers", { filesWithMarkers });

                // Check status matrix for staged files (considered resolved)
                const matrix = await git.statusMatrix({ fs, dir });
                logger.info("Checking status matrix", { matrixSize: matrix.length });
                for (const [filepath, head, workdir, stage] of matrix) {
                    if (seenPaths.has(filepath)) continue;

                    // File is staged and different from head - might be a resolved conflict
                    if (stage === 3 || (head === 1 && workdir === 2 && stage === 2)) {
                        const hasMarkers = await this.hasConflictMarkers(filepath);
                        logger.info("Found file in status matrix", { filepath, head, workdir, stage, hasMarkers });
                        conflicts.push({
                            path: filepath,
                            status: "both_modified",
                            resolved: !hasMarkers,
                        });
                    }
                }
            } catch (e) {
                logger.error("Failed to get conflict files", { error: String(e) });
            }

            logger.info("Getting conflict files - done", { totalConflicts: conflicts.length });
            return conflicts;
        },

        /**
         * Check if a file has conflict markers
         * Requires ALL THREE markers to be present to avoid false positives
         * (e.g., "=======" appears in Markdown Setext headings)
         */
        async hasConflictMarkers(filepath: string): Promise<boolean> {
            try {
                const fullPath = `${dir}/${filepath}`;
                const file = Bun.file(fullPath);
                if (!(await file.exists())) return false;

                const content = await file.text();
                // Must have all three markers to be a real conflict
                const hasOurs = content.includes("<<<<<<<");
                const hasSeparator = content.includes("=======");
                const hasTheirs = content.includes(">>>>>>>");
                return hasOurs && hasSeparator && hasTheirs;
            } catch {
                return false;
            }
        },

        /**
         * Resolve a conflict by choosing ours or theirs
         * Uses our stored merge state to get the correct versions
         */
        async resolveConflict(filepath: string, resolution: "ours" | "theirs" | "mark-resolved"): Promise<void> {
            logger.info("Resolving conflict", { filepath, resolution });

            if (resolution === "mark-resolved") {
                // Just stage the file as-is (user has manually resolved)
                await git.add({ fs, dir, filepath });
                return;
            }

            // Get our merge state
            const mergeState = await this.getMergeState();

            try {
                let refToUse: string;

                if (resolution === "ours") {
                    // Use stored oursOid or fall back to HEAD
                    refToUse = mergeState?.oursOid ?? "HEAD";
                } else {
                    // Use stored theirsOid or fall back to MERGE_HEAD
                    refToUse = mergeState?.theirsOid ?? "MERGE_HEAD";

                    // If we don't have theirsOid stored, try to read MERGE_HEAD
                    if (!mergeState?.theirsOid) {
                        try {
                            const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
                            const mergeHeadFile = Bun.file(mergeHeadPath);
                            if (await mergeHeadFile.exists()) {
                                refToUse = (await mergeHeadFile.text()).trim();
                            }
                        } catch {
                            // MERGE_HEAD doesn't exist, stick with default
                        }
                    }
                }

                // Read the blob from the appropriate ref
                const blob = await git.readBlob({
                    fs,
                    dir,
                    oid: refToUse,
                    filepath,
                });

                // Write the content to the file
                const fullPath = `${dir}/${filepath}`;
                await fs.promises.writeFile(fullPath, Buffer.from(blob.blob));

                // Stage the file
                await git.add({ fs, dir, filepath });
                logger.info("Conflict resolved", { filepath, resolution, ref: refToUse });
            } catch (e) {
                logger.error("Failed to resolve conflict", { filepath, resolution, error: String(e) });
                throw new Error(`Failed to resolve conflict: ${String(e)}`);
            }
        },

        /**
         * Get conflict content (ours, theirs, merged)
         * Uses our stored merge state to get the theirs version
         */
        async getConflictContent(filepath: string): Promise<{
            oursContent: string;
            theirsContent: string;
            mergedContent: string;
        }> {
            let oursContent = "";
            let theirsContent = "";
            let mergedContent = "";

            // Get our merge state to find theirs oid
            const mergeState = await this.getMergeState();
            logger.info("Getting conflict content", {
                filepath,
                hasState: !!mergeState,
                oursOid: mergeState?.oursOid?.slice(0, 7),
                theirsOid: mergeState?.theirsOid?.slice(0, 7)
            });

            try {
                // Get ours (from our stored oursOid or HEAD)
                try {
                    const oursRef = mergeState?.oursOid ?? "HEAD";
                    logger.info("Reading ours blob", { oursRef: oursRef.slice(0, 7), filepath });
                    const ours = await git.readBlob({ fs, dir, oid: oursRef, filepath });
                    oursContent = Buffer.from(ours.blob).toString("utf-8");
                    logger.info("Got ours content", { length: oursContent.length });
                } catch (e) {
                    logger.error("Failed to read ours blob", { filepath, error: String(e) });
                    oursContent = "";
                }

                // Get theirs (from stored theirsOid, or fall back to MERGE_HEAD for compatibility)
                try {
                    let theirsRef = mergeState?.theirsOid;
                    if (!theirsRef) {
                        // Fall back to MERGE_HEAD for compatibility
                        try {
                            const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
                            const mergeHeadFile = Bun.file(mergeHeadPath);
                            if (await mergeHeadFile.exists()) {
                                theirsRef = (await mergeHeadFile.text()).trim();
                            }
                        } catch {
                            // MERGE_HEAD doesn't exist
                        }
                    }

                    if (theirsRef) {
                        logger.info("Reading theirs blob", { theirsRef: theirsRef.slice(0, 7), filepath });
                        const theirs = await git.readBlob({ fs, dir, oid: theirsRef, filepath });
                        theirsContent = Buffer.from(theirs.blob).toString("utf-8");
                        logger.info("Got theirs content", { length: theirsContent.length });
                    } else {
                        logger.warn("No theirs ref available", { filepath });
                    }
                } catch (e) {
                    logger.error("Failed to read theirs blob", { filepath, error: String(e) });
                    theirsContent = "";
                }

                // Get current merged content (with conflict markers) from working directory
                try {
                    const fullPath = `${dir}/${filepath}`;
                    const file = Bun.file(fullPath);
                    if (await file.exists()) {
                        mergedContent = await file.text();
                    }
                } catch {
                    mergedContent = "";
                }

                // If ours or theirs failed but we have merged content with markers,
                // try to extract ours/theirs from the conflict markers
                if ((oursContent === "" || theirsContent === "") && mergedContent.includes("<<<<<<<")) {
                    logger.info("Extracting content from conflict markers");
                    const extracted = this.extractFromConflictMarkers(mergedContent);
                    if (oursContent === "" && extracted.ours) {
                        oursContent = extracted.ours;
                    }
                    if (theirsContent === "" && extracted.theirs) {
                        theirsContent = extracted.theirs;
                    }
                }
            } catch (e) {
                logger.error("Failed to get conflict content", { filepath, error: String(e) });
            }

            return { oursContent, theirsContent, mergedContent };
        },

        /**
         * Extract ours/theirs content from a file with conflict markers
         */
        extractFromConflictMarkers(content: string): { ours: string; theirs: string } {
            const lines = content.split("\n");
            const oursLines: string[] = [];
            const theirsLines: string[] = [];
            const commonLines: string[] = [];

            let inConflict = false;
            let inOurs = false;
            let inTheirs = false;

            for (const line of lines) {
                if (line.startsWith("<<<<<<<")) {
                    inConflict = true;
                    inOurs = true;
                    inTheirs = false;
                } else if (line.startsWith("=======")) {
                    inOurs = false;
                    inTheirs = true;
                } else if (line.startsWith(">>>>>>>")) {
                    inConflict = false;
                    inOurs = false;
                    inTheirs = false;
                } else if (inConflict) {
                    if (inOurs) {
                        oursLines.push(line);
                    } else if (inTheirs) {
                        theirsLines.push(line);
                    }
                } else {
                    // Common line - add to both
                    commonLines.push(line);
                    oursLines.push(line);
                    theirsLines.push(line);
                }
            }

            return {
                ours: oursLines.join("\n"),
                theirs: theirsLines.join("\n")
            };
        },

        /**
         * Abort the current merge
         */
        async abortMerge(): Promise<void> {
            logger.info("Aborting merge");

            // Get merge state to know what to reset to
            const mergeState = await this.getMergeState();
            const resetRef = mergeState?.oursOid ?? "HEAD";

            // Remove MERGE_HEAD file (for compatibility)
            const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
            try {
                await fs.promises.unlink(mergeHeadPath);
            } catch {
                // File might not exist
            }

            // Clear our custom merge state
            await this.clearMergeState();

            // Reset to HEAD (or stored oursOid)
            await git.checkout({ fs, dir, ref: resetRef, force: true });
            logger.info("Merge aborted", { resetRef });
        },

        /**
         * Complete a merge after all conflicts have been resolved
         * Creates a proper merge commit with both parents
         */
        async completeMerge(message?: string): Promise<string> {
            logger.info("Completing merge");

            // Get our merge state
            const mergeState = await this.getMergeState();
            if (!mergeState) {
                throw new Error("No merge in progress");
            }

            // Check that all conflicts are resolved
            const conflicts = await this.getConflictFiles();
            const unresolvedConflicts = conflicts.filter((c) => !c.resolved);
            if (unresolvedConflicts.length > 0) {
                throw new Error(`There are still ${unresolvedConflicts.length} unresolved conflicts`);
            }

            // Stage any remaining changes
            await this.addAll();

            // Create merge commit with both parents
            const commitMessage = message ?? `Merge ${mergeState.theirsRef} into ${mergeState.oursRef}`;
            const sha = await git.commit({
                fs,
                dir,
                message: commitMessage,
                author,
                parent: [mergeState.oursOid, mergeState.theirsOid],
            });

            logger.info("Merge commit created", { sha: sha.slice(0, 7), message: commitMessage });

            // Clean up merge state
            await this.clearMergeState();

            // Also remove MERGE_HEAD if it exists (for compatibility)
            const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
            try {
                await fs.promises.unlink(mergeHeadPath);
            } catch {
                // File might not exist
            }

            logger.info("Merge completed");
            return sha;
        },

        /**
         * Get the merge state file path
         */
        getMergeStatePath(): string {
            return `${dir}/.git/${MERGE_STATE_FILE}`;
        },

        /**
         * Save merge state to file
         */
        async saveMergeState(state: MergeState): Promise<void> {
            const statePath = this.getMergeStatePath();
            await Bun.write(statePath, JSON.stringify(state, null, 2));
            logger.info("Saved merge state", { oursRef: state.oursRef, theirsRef: state.theirsRef, conflictCount: state.conflictFiles.length });
        },

        /**
         * Load merge state from file
         */
        async getMergeState(): Promise<MergeState | null> {
            try {
                const statePath = this.getMergeStatePath();
                logger.info("Reading merge state file", { statePath });
                const file = Bun.file(statePath);
                const exists = await file.exists();
                logger.info("Merge state file exists check", { exists, statePath });
                if (!exists) return null;
                const content = await file.text();
                const state = JSON.parse(content) as MergeState;
                logger.info("Loaded merge state from file", {
                    inProgress: state.inProgress,
                    conflictFilesCount: state.conflictFiles?.length,
                    oursRef: state.oursRef,
                    theirsRef: state.theirsRef,
                    startedAt: state.startedAt
                });
                return state;
            } catch (e) {
                logger.error("Failed to load merge state", { error: String(e) });
                return null;
            }
        },

        /**
         * Delete merge state file
         */
        async clearMergeState(): Promise<void> {
            const statePath = this.getMergeStatePath();
            try {
                const exists = await Bun.file(statePath).exists();
                if (exists) {
                    await fs.promises.unlink(statePath);
                    logger.info("Cleared merge state file", { statePath });
                } else {
                    logger.info("No merge state file to clear", { statePath });
                }
            } catch (e) {
                logger.warn("Failed to clear merge state file", { statePath, error: String(e) });
            }
        },

        /**
         * Set upstream tracking
         */
        async setUpstream(branch: string, remote: string, remoteBranch: string): Promise<void> {
            // isomorphic-git doesn't have a direct setUpstream, so we modify the config
            await git.setConfig({
                fs,
                dir,
                path: `branch.${branch}.remote`,
                value: remote,
            });
            await git.setConfig({
                fs,
                dir,
                path: `branch.${branch}.merge`,
                value: `refs/heads/${remoteBranch}`,
            });
        },

        /**
         * Get upstream tracking info
         */
        async getUpstream(branch: string): Promise<{ remote: string; ref: string } | undefined> {
            try {
                const remote = await git.getConfig({ fs, dir, path: `branch.${branch}.remote` });
                const merge = await git.getConfig({ fs, dir, path: `branch.${branch}.merge` });

                if (remote && merge) {
                    const ref = String(merge).replace("refs/heads/", "");
                    return { remote: String(remote), ref };
                }
            } catch {
                // No upstream configured
            }
            return undefined;
        },
    };
}

/**
 * Format a timestamp as relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months ago`;
    return `${Math.floor(seconds / 31536000)} years ago`;
}

export type GitClient = ReturnType<typeof createGitClient>;
