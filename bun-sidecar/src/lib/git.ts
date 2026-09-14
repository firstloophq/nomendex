/**
 * Git operations wrapper around the system git binary.
 *
 * Shells out to /usr/bin/git (Xcode Command Line Tools) via Bun.$.
 * Native git gives us proper fetch negotiation, delta packs, automatic
 * garbage collection, real merges with conflict markers, and credential
 * helpers for free — none of which isomorphic-git provided.
 */

import { createServiceLogger } from "./logger";

const logger = createServiceLogger("GIT");

const GIT_BIN = "/usr/bin/git";

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

interface GitClientConfig {
    dir: string;
    author?: { name: string; email: string };
}

export type AuthConfig =
    | { mode: "token"; token: string }
    | { mode: "local" };

interface RunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

interface RunOptions {
    auth?: AuthConfig;
    /** Extra environment variables for this invocation */
    env?: Record<string, string>;
}

/**
 * Check whether the system git binary is usable.
 * On a Mac without Xcode Command Line Tools, /usr/bin/git exists but exits non-zero.
 */
export async function getGitVersion(): Promise<string | null> {
    try {
        const result = await Bun.$`${GIT_BIN} --version`.nothrow().quiet();
        if (result.exitCode !== 0) return null;
        return result.stdout.toString().trim();
    } catch {
        return null;
    }
}

/**
 * Create a git client for a specific directory
 */
export function createGitClient(config: GitClientConfig) {
    const { dir, author = DEFAULT_AUTHOR } = config;

    /**
     * Run a git command in the workspace directory.
     * Never throws on non-zero exit; callers inspect exitCode.
     */
    const run = async (args: string[], opts: RunOptions = {}): Promise<RunResult> => {
        const env: Record<string, string | undefined> = {
            ...process.env,
            // Never block on an interactive prompt
            GIT_TERMINAL_PROMPT: "0",
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_COMMITTER_NAME: author.name,
            GIT_COMMITTER_EMAIL: author.email,
            ...opts.env,
        };

        const configArgs: string[] = [];
        if (opts.auth?.mode === "token") {
            // Feed the PAT through an inline credential helper so it never
            // touches disk, the keychain, or the visible command line.
            env.NOMENDEX_GIT_TOKEN = opts.auth.token;
            configArgs.push(
                "-c", "credential.helper=",
                "-c", "credential.helper=!f() { echo username=x-access-token; echo \"password=$NOMENDEX_GIT_TOKEN\"; }; f",
            );
        }

        const fullArgs = [...configArgs, ...args];
        const result = await Bun.$`${GIT_BIN} ${fullArgs}`.cwd(dir).env(env).nothrow().quiet();
        return {
            exitCode: result.exitCode,
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
        };
    };

    /** Run and throw a readable error on failure */
    const runOrThrow = async (args: string[], opts: RunOptions = {}): Promise<string> => {
        const result = await run(args, opts);
        if (result.exitCode !== 0) {
            const detail = (result.stderr || result.stdout).trim();
            throw new Error(`git ${args[0]} failed: ${detail}`);
        }
        return result.stdout;
    };

    const revParse = async (ref: string): Promise<string | undefined> => {
        const result = await run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
        return result.exitCode === 0 ? result.stdout.trim() : undefined;
    };

    const parseLog = (output: string): CommitInfo[] => {
        return output
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => {
                const [hash = "", authorName = "", timestamp = "0", ...rest] = line.split("\x1f");
                return {
                    hash: hash.slice(0, 7),
                    message: rest.join("\x1f"),
                    author: authorName,
                    date: formatRelativeTime(Number(timestamp) * 1000),
                };
            });
    };

    const LOG_FORMAT = "--format=%H%x1f%an%x1f%at%x1f%s";

    /** Files with unmerged index entries, with their conflict type */
    const getUnmergedFiles = async (): Promise<Array<{ path: string; status: ConflictFile["status"] }>> => {
        const result = await run(["status", "--porcelain=v1", "-z", "--untracked-files=no"]);
        if (result.exitCode !== 0) return [];

        const files: Array<{ path: string; status: ConflictFile["status"] }> = [];
        for (const entry of result.stdout.split("\0")) {
            if (entry.length < 4) continue;
            const xy = entry.slice(0, 2);
            const path = entry.slice(3);
            switch (xy) {
                case "UU":
                    files.push({ path, status: "both_modified" });
                    break;
                case "AA":
                    files.push({ path, status: "both_added" });
                    break;
                case "DU":
                    files.push({ path, status: "deleted_by_us" });
                    break;
                case "UD":
                    files.push({ path, status: "deleted_by_them" });
                    break;
                case "AU":
                case "UA":
                case "DD":
                    files.push({ path, status: "both_modified" });
                    break;
            }
        }
        return files;
    };

    /**
     * Files git recorded as conflicted when the merge started.
     * git writes a "# Conflicts:" section into .git/MERGE_MSG on a conflicted merge.
     */
    const getOriginalConflictFiles = async (): Promise<string[]> => {
        try {
            const file = Bun.file(`${dir}/.git/MERGE_MSG`);
            if (!(await file.exists())) return [];
            const lines = (await file.text()).split("\n");
            const start = lines.findIndex((l) => l.trim() === "# Conflicts:");
            if (start === -1) return [];
            const files: string[] = [];
            for (const line of lines.slice(start + 1)) {
                const match = line.match(/^#\t(.+)$/);
                if (!match?.[1]) break;
                files.push(match[1]);
            }
            return files;
        } catch {
            return [];
        }
    };

    return {
        /**
         * Initialize a new git repository
         */
        async init(): Promise<void> {
            logger.info("Initializing git repository", { dir });
            await runOrThrow(["init"]);
            logger.info("Git repository initialized");
        },

        /**
         * Check if directory is a git repository
         */
        async isRepo(): Promise<boolean> {
            const result = await run(["rev-parse", "--is-inside-work-tree"]);
            return result.exitCode === 0 && result.stdout.trim() === "true";
        },

        /**
         * Get current branch name
         */
        async currentBranch(): Promise<string | undefined> {
            const result = await run(["symbolic-ref", "--short", "--quiet", "HEAD"]);
            if (result.exitCode !== 0) return undefined;
            const branch = result.stdout.trim();
            return branch.length > 0 ? branch : undefined;
        },

        /**
         * List all local branches
         */
        async listBranches(): Promise<string[]> {
            const result = await run(["branch", "--format=%(refname:short)"]);
            if (result.exitCode !== 0) return [];
            return result.stdout.split("\n").map((b) => b.trim()).filter((b) => b.length > 0);
        },

        /**
         * Create a new branch
         */
        async createBranch(name: string): Promise<void> {
            await runOrThrow(["branch", name]);
        },

        /**
         * Checkout a branch
         */
        async checkout(ref: string): Promise<void> {
            await runOrThrow(["checkout", ref]);
        },

        /**
         * Get repository status
         */
        async status(): Promise<StatusResult> {
            const result = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
            if (result.exitCode !== 0) {
                throw new Error(`git status failed: ${result.stderr.trim()}`);
            }

            const changedFiles: FileChange[] = [];
            const entries = result.stdout.split("\0");
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (!entry || entry.length < 4) continue;
                const x = entry[0];
                const y = entry[1];
                const path = entry.slice(3);

                // Renames/copies carry the original path in the next NUL-separated field
                if (x === "R" || x === "C") i++;

                if (x === "?" && y === "?") {
                    changedFiles.push({ path, status: "untracked" });
                } else if (x === "A" && y !== "D") {
                    changedFiles.push({ path, status: "added" });
                } else if (x === "D" || y === "D") {
                    changedFiles.push({ path, status: "deleted" });
                } else if (x === "!" && y === "!") {
                    // ignored - skip
                } else {
                    changedFiles.push({ path, status: "modified" });
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
        async log(opts: { depth?: number; ref?: string } = {}): Promise<CommitInfo[]> {
            const args = ["log", `-n${opts.depth ?? 5}`, LOG_FORMAT];
            if (opts.ref) args.push(opts.ref);
            const result = await run(args);
            if (result.exitCode !== 0) return [];
            return parseLog(result.stdout);
        },

        /**
         * Stage all changes (add new/modified, remove deleted)
         */
        async addAll(): Promise<void> {
            await runOrThrow(["add", "--all"]);
        },

        /**
         * Check if there are staged changes
         */
        async hasStagedChanges(): Promise<boolean> {
            // Exit code 1 means there are differences; 0 means none
            const result = await run(["diff", "--cached", "--quiet"]);
            return result.exitCode === 1;
        },

        /**
         * Create a commit
         */
        async commit(message: string): Promise<string> {
            await runOrThrow(["commit", "--quiet", "-m", message]);
            const sha = (await revParse("HEAD")) ?? "";
            logger.info("Created commit", { sha: sha.slice(0, 7), message });
            return sha;
        },

        /**
         * Add a remote (or update its URL if it already exists)
         */
        async addRemote(name: string, url: string): Promise<void> {
            if (await this.hasRemote(name)) {
                await runOrThrow(["remote", "set-url", name, url]);
            } else {
                await runOrThrow(["remote", "add", name, url]);
            }
        },

        /**
         * Get remote URL
         */
        async getRemoteUrl(name: string): Promise<string | undefined> {
            const result = await run(["remote", "get-url", name]);
            if (result.exitCode !== 0) return undefined;
            const url = result.stdout.trim();
            return url.length > 0 ? url : undefined;
        },

        /**
         * Check if a remote exists
         */
        async hasRemote(name: string): Promise<boolean> {
            const remotes = await this.listRemotes();
            return remotes.some((r) => r.remote === name);
        },

        /**
         * List remotes
         */
        async listRemotes(): Promise<Array<{ remote: string; url: string }>> {
            const result = await run(["remote", "-v"]);
            if (result.exitCode !== 0) return [];
            const remotes: Array<{ remote: string; url: string }> = [];
            for (const line of result.stdout.split("\n")) {
                const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
                if (match?.[1] && match[2]) {
                    remotes.push({ remote: match[1], url: match[2] });
                }
            }
            return remotes;
        },

        /**
         * Fetch from remote
         */
        async fetch(auth: AuthConfig, remote = "origin", ref?: string): Promise<void> {
            logger.info("Fetching from remote", { remote, ref });
            const args = ["fetch", "--quiet", remote];
            if (ref) args.push(ref);
            await runOrThrow(args, { auth });
            logger.info("Fetch completed");
        },

        /**
         * Pull from remote (fetch + merge).
         * On conflict, git leaves the repo in a merge state with conflict
         * markers written to the working tree.
         */
        async pull(auth: AuthConfig, remote = "origin", ref?: string): Promise<{ hadConflicts: boolean; conflictFiles: string[] }> {
            logger.info("Pulling from remote", { remote, ref });

            const branch = ref ?? (await this.currentBranch());
            if (!branch) {
                throw new Error("Not on any branch");
            }

            await this.fetch(auth, remote, branch);

            const oursOid = await revParse("HEAD");
            const theirsOid = await revParse(`${remote}/${branch}`);

            if (!theirsOid) {
                logger.info("Remote branch doesn't exist, nothing to merge");
                return { hadConflicts: false, conflictFiles: [] };
            }

            if (oursOid === theirsOid) {
                logger.info("Already up to date");
                return { hadConflicts: false, conflictFiles: [] };
            }

            const merge = await run(["merge", "--no-edit", `${remote}/${branch}`]);
            if (merge.exitCode === 0) {
                logger.info("Pull completed (fast-forward or clean merge)");
                return { hadConflicts: false, conflictFiles: [] };
            }

            if (await this.hasMergeConflict()) {
                const conflictFiles = (await getUnmergedFiles()).map((f) => f.path);
                logger.info("Merge conflict detected", { conflictFiles });
                return { hadConflicts: true, conflictFiles };
            }

            throw new Error(`git merge failed: ${(merge.stderr || merge.stdout).trim()}`);
        },

        /**
         * Push to remote
         */
        async push(auth: AuthConfig, remote = "origin", ref?: string): Promise<void> {
            logger.info("Pushing to remote", { remote, ref });
            const args = ["push", "--quiet", remote];
            if (ref) args.push(ref);
            await runOrThrow(args, { auth });
            logger.info("Push completed");
        },

        /**
         * Check if remote branch exists
         */
        async remoteBranchExists(auth: AuthConfig, remote: string, branch: string): Promise<boolean> {
            const result = await run(["ls-remote", "--heads", "--exit-code", remote, branch], { auth });
            if (result.exitCode === 0) return true;
            if (result.exitCode !== 2) {
                // 2 = no matching refs; anything else is a real error
                logger.debug("Remote branch check failed", { error: result.stderr.trim() });
            }
            return false;
        },

        /**
         * Get fetch status (ahead/behind counts and incoming changes)
         */
        async getFetchStatus(auth: AuthConfig, branch: string): Promise<FetchStatusResult> {
            const result: FetchStatusResult = {
                behindCount: 0,
                aheadCount: 0,
                incomingCommits: [],
                incomingFiles: [],
            };

            await this.fetch(auth, "origin", branch);

            const remoteRef = `origin/${branch}`;
            if (!(await revParse(remoteRef))) {
                // Remote branch doesn't exist yet
                return result;
            }

            const counts = await run(["rev-list", "--left-right", "--count", `${branch}...${remoteRef}`]);
            if (counts.exitCode === 0) {
                const [ahead = "0", behind = "0"] = counts.stdout.trim().split(/\s+/);
                result.aheadCount = Number(ahead);
                result.behindCount = Number(behind);
            }

            if (result.behindCount > 0) {
                result.incomingCommits = await this.log({ depth: 50, ref: `${branch}..${remoteRef}` });

                const diff = await run(["diff", "--name-status", "-z", branch, remoteRef]);
                if (diff.exitCode === 0) {
                    const fields = diff.stdout.split("\0");
                    for (let i = 0; i < fields.length; i++) {
                        const code = fields[i];
                        if (!code) continue;
                        const status = code[0] ?? "M";
                        // Renames and copies have two path fields; report the new path
                        const path = status === "R" || status === "C" ? fields[i + 2] : fields[i + 1];
                        i += status === "R" || status === "C" ? 2 : 1;
                        if (path) {
                            result.incomingFiles.push({ status, path });
                        }
                    }
                }
            }

            return result;
        },

        /**
         * Check if a merge is in progress (git writes MERGE_HEAD on a conflicted merge)
         */
        async hasMergeConflict(): Promise<boolean> {
            const result = await run(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
            return result.exitCode === 0;
        },

        /**
         * Get conflicting files. Files still unmerged in the index are unresolved;
         * files git originally flagged that have since been staged are resolved.
         */
        async getConflictFiles(): Promise<ConflictFile[]> {
            const unmerged = await getUnmergedFiles();
            const conflicts: ConflictFile[] = unmerged.map((f) => ({ ...f, resolved: false }));
            const seen = new Set(unmerged.map((f) => f.path));

            for (const path of await getOriginalConflictFiles()) {
                if (!seen.has(path)) {
                    conflicts.push({ path, status: "both_modified", resolved: true });
                    seen.add(path);
                }
            }

            return conflicts;
        },

        /**
         * Check if a file has conflict markers.
         * Requires all three markers to avoid false positives
         * (e.g. "=======" appears in Markdown Setext headings).
         */
        async hasConflictMarkers(filepath: string): Promise<boolean> {
            try {
                const file = Bun.file(`${dir}/${filepath}`);
                if (!(await file.exists())) return false;
                const content = await file.text();
                return content.includes("<<<<<<<") && content.includes("=======") && content.includes(">>>>>>>");
            } catch {
                return false;
            }
        },

        /**
         * Resolve a conflict by choosing ours or theirs, or marking the
         * working-tree version as resolved.
         */
        async resolveConflict(filepath: string, resolution: "ours" | "theirs" | "mark-resolved"): Promise<void> {
            logger.info("Resolving conflict", { filepath, resolution });

            if (resolution !== "mark-resolved") {
                const checkout = await run(["checkout", `--${resolution}`, "--", filepath]);
                if (checkout.exitCode !== 0) {
                    // The chosen side deleted the file; honour that
                    logger.info("Chosen side has no version of file, removing it", { filepath, resolution });
                    await runOrThrow(["rm", "--quiet", "--force", "--", filepath]);
                    return;
                }
            }

            await runOrThrow(["add", "--", filepath]);
            logger.info("Conflict resolved", { filepath, resolution });
        },

        /**
         * Get conflict content (ours, theirs, merged)
         */
        async getConflictContent(filepath: string): Promise<{
            oursContent: string;
            theirsContent: string;
            mergedContent: string;
        }> {
            // Stage 2 = ours, stage 3 = theirs while the file is unmerged.
            // Fall back to the commits themselves once the file has been staged.
            const readBlob = async (specs: string[]): Promise<string> => {
                for (const spec of specs) {
                    const result = await run(["show", spec]);
                    if (result.exitCode === 0) return result.stdout;
                }
                return "";
            };

            const oursContent = await readBlob([`:2:${filepath}`, `HEAD:${filepath}`]);
            const theirsContent = await readBlob([`:3:${filepath}`, `MERGE_HEAD:${filepath}`]);

            let mergedContent = "";
            try {
                const file = Bun.file(`${dir}/${filepath}`);
                if (await file.exists()) {
                    mergedContent = await file.text();
                }
            } catch {
                mergedContent = "";
            }

            return { oursContent, theirsContent, mergedContent };
        },

        /**
         * Abort the current merge and restore the pre-merge state
         */
        async abortMerge(): Promise<void> {
            logger.info("Aborting merge");
            await runOrThrow(["merge", "--abort"]);
            logger.info("Merge aborted");
        },

        /**
         * Complete a merge after all conflicts have been resolved
         */
        async completeMerge(message?: string): Promise<string> {
            logger.info("Completing merge");

            if (!(await this.hasMergeConflict())) {
                throw new Error("No merge in progress");
            }

            const unresolved = await getUnmergedFiles();
            if (unresolved.length > 0) {
                throw new Error(`There are still ${unresolved.length} unresolved conflicts`);
            }

            await this.addAll();

            const args = ["commit", "--quiet"];
            if (message) {
                args.push("-m", message);
            } else {
                args.push("--no-edit");
            }
            await runOrThrow(args);

            const sha = (await revParse("HEAD")) ?? "";
            logger.info("Merge commit created", { sha: sha.slice(0, 7) });
            return sha;
        },

        /**
         * Set upstream tracking
         */
        async setUpstream(branch: string, remote: string, remoteBranch: string): Promise<void> {
            await runOrThrow(["config", `branch.${branch}.remote`, remote]);
            await runOrThrow(["config", `branch.${branch}.merge`, `refs/heads/${remoteBranch}`]);
        },

        /**
         * Get upstream tracking info
         */
        async getUpstream(branch: string): Promise<{ remote: string; ref: string } | undefined> {
            const remote = await run(["config", "--get", `branch.${branch}.remote`]);
            const merge = await run(["config", "--get", `branch.${branch}.merge`]);
            if (remote.exitCode !== 0 || merge.exitCode !== 0) return undefined;
            const remoteName = remote.stdout.trim();
            const ref = merge.stdout.trim().replace("refs/heads/", "");
            if (!remoteName || !ref) return undefined;
            return { remote: remoteName, ref };
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
