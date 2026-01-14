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
    name: "Noetect",
    email: "sync@noetect.app",
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

                if (head === 0 && workdir === 2) {
                    changedFiles.push({ path: filepath, status: "untracked" });
                } else if (head === 0 && stage === 2) {
                    changedFiles.push({ path: filepath, status: "added" });
                } else if (head === 1 && workdir === 0) {
                    changedFiles.push({ path: filepath, status: "deleted" });
                } else if (head === 1 && workdir === 2) {
                    changedFiles.push({ path: filepath, status: "modified" });
                } else if (stage === 2 && head !== stage) {
                    changedFiles.push({ path: filepath, status: "modified" });
                } else if (stage === 3) {
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
         * Pull from remote (fetch + merge)
         */
        async pull(auth: AuthConfig, remote = "origin", ref?: string): Promise<void> {
            logger.info("Pulling from remote", { remote, ref });
            await git.pull({
                fs,
                http,
                dir,
                remote,
                ref,
                singleBranch: true,
                author,
                onAuth: createOnAuth(auth),
            });
            logger.info("Pull completed");
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
         */
        async hasMergeConflict(): Promise<boolean> {
            try {
                const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
                return await Bun.file(mergeHeadPath).exists();
            } catch {
                return false;
            }
        },

        /**
         * Get conflicting files
         */
        async getConflictFiles(): Promise<ConflictFile[]> {
            const conflicts: ConflictFile[] = [];

            try {
                // Read the index to find conflicting entries
                const index = await git.listFiles({ fs, dir });

                // Check status matrix for conflicts
                const matrix = await git.statusMatrix({ fs, dir });

                for (const [filepath, head, workdir, stage] of matrix) {
                    // Check if file has conflict markers
                    if (stage === 3 || (head === 1 && workdir === 2 && stage === 2)) {
                        const hasMarkers = await this.hasConflictMarkers(filepath);
                        conflicts.push({
                            path: filepath,
                            status: "both_modified",
                            resolved: !hasMarkers,
                        });
                    }
                }

                // Also check for files with conflict markers that might not be in a merge state
                for (const filepath of index) {
                    if (!conflicts.find((c) => c.path === filepath)) {
                        const hasMarkers = await this.hasConflictMarkers(filepath);
                        if (hasMarkers) {
                            conflicts.push({
                                path: filepath,
                                status: "both_modified",
                                resolved: false,
                            });
                        }
                    }
                }
            } catch (e) {
                logger.error("Failed to get conflict files", { error: String(e) });
            }

            return conflicts;
        },

        /**
         * Check if a file has conflict markers
         */
        async hasConflictMarkers(filepath: string): Promise<boolean> {
            try {
                const fullPath = `${dir}/${filepath}`;
                const file = Bun.file(fullPath);
                if (!(await file.exists())) return false;

                const content = await file.text();
                return content.includes("<<<<<<<") || content.includes("=======") || content.includes(">>>>>>>");
            } catch {
                return false;
            }
        },

        /**
         * Resolve a conflict by choosing ours or theirs
         */
        async resolveConflict(filepath: string, resolution: "ours" | "theirs" | "mark-resolved"): Promise<void> {
            logger.info("Resolving conflict", { filepath, resolution });

            if (resolution === "mark-resolved") {
                // Just stage the file as-is (user has manually resolved)
                await git.add({ fs, dir, filepath });
                return;
            }

            // Get the oid for the version we want
            // In a merge conflict, stage 2 is ours (HEAD), stage 3 is theirs (MERGE_HEAD)
            try {
                // Read the blob from the appropriate ref
                const index = await git.readBlob({
                    fs,
                    dir,
                    oid: resolution === "ours" ? "HEAD" : "MERGE_HEAD",
                    filepath,
                });

                // Write the content to the file
                const fullPath = `${dir}/${filepath}`;
                await fs.promises.writeFile(fullPath, Buffer.from(index.blob));

                // Stage the file
                await git.add({ fs, dir, filepath });
                logger.info("Conflict resolved", { filepath, resolution });
            } catch (e) {
                logger.error("Failed to resolve conflict", { filepath, resolution, error: String(e) });
                throw new Error(`Failed to resolve conflict: ${String(e)}`);
            }
        },

        /**
         * Get conflict content (ours, theirs, merged)
         */
        async getConflictContent(filepath: string): Promise<{
            oursContent: string;
            theirsContent: string;
            mergedContent: string;
        }> {
            let oursContent = "";
            let theirsContent = "";
            let mergedContent = "";

            try {
                // Get ours (HEAD)
                try {
                    const ours = await git.readBlob({ fs, dir, oid: "HEAD", filepath });
                    oursContent = Buffer.from(ours.blob).toString("utf-8");
                } catch {
                    oursContent = "";
                }

                // Get theirs (MERGE_HEAD)
                try {
                    const theirs = await git.readBlob({ fs, dir, oid: "MERGE_HEAD", filepath });
                    theirsContent = Buffer.from(theirs.blob).toString("utf-8");
                } catch {
                    theirsContent = "";
                }

                // Get current merged content (with conflict markers)
                try {
                    const fullPath = `${dir}/${filepath}`;
                    const file = Bun.file(fullPath);
                    if (await file.exists()) {
                        mergedContent = await file.text();
                    }
                } catch {
                    mergedContent = "";
                }
            } catch (e) {
                logger.error("Failed to get conflict content", { filepath, error: String(e) });
            }

            return { oursContent, theirsContent, mergedContent };
        },

        /**
         * Abort the current merge
         */
        async abortMerge(): Promise<void> {
            logger.info("Aborting merge");

            // Remove MERGE_HEAD file
            const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
            try {
                await fs.promises.unlink(mergeHeadPath);
            } catch {
                // File might not exist
            }

            // Reset to HEAD
            await git.checkout({ fs, dir, ref: "HEAD", force: true });
            logger.info("Merge aborted");
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
