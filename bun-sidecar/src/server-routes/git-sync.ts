import { RouteHandler } from "../types/Routes";
import { getRootPath } from "../storage/root-path";
import { createServiceLogger } from "../lib/logger";
import { createGitClient, CommitInfo, ConflictFile } from "../lib/git";

const logger = createServiceLogger("GIT-SYNC");

// Get GitHub PAT from environment (loaded from secrets)
function getGitHubPAT(): string | undefined {
    const pat = process.env.GITHUB_PAT;
    if (pat) {
        const trimmed = pat.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return undefined;
}

// Create git client for the current workspace
function getGitClient() {
    return createGitClient({ dir: getRootPath() });
}

// Get auth config from PAT
function getAuthConfig(): { token: string } | null {
    const pat = getGitHubPAT();
    if (!pat) return null;
    return { token: pat };
}

interface GitStatusResponse {
    success: boolean;
    initialized: boolean;
    hasRemote: boolean;
    remoteUrl?: string;
    currentBranch?: string;
    remoteBranch?: string;
    status?: string;
    changedFiles?: number;
    hasUncommittedChanges?: boolean;
    hasMergeConflict?: boolean;
    conflictCount?: number;
    recentCommits?: CommitInfo[];
    error?: string;
}

interface GitSyncResponse {
    success: boolean;
    message?: string;
    error?: string;
}

// Check if git is available (always true with isomorphic-git)
interface GitInstalledResponse {
    success: boolean;
    installed: boolean;
    version?: string;
    error?: string;
}

export const gitInstalledRoute: RouteHandler<GitInstalledResponse> = {
    GET: async (_req) => {
        // With isomorphic-git, we don't need external git installed
        logger.info("Checking git availability (isomorphic-git)");
        return Response.json({
            success: true,
            installed: true,
            version: "isomorphic-git",
        });
    },
};

// Initialize git repo and ensure .gitignore exists
export const gitInitRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            logger.info("Initializing git repo", { path: getRootPath() });

            const isInitialized = await git.isRepo();

            if (!isInitialized) {
                await git.init();
                logger.info("Git repo initialized", { path: getRootPath() });
            }

            // Ensure .gitignore exists with secrets.json
            const gitignorePath = `${getRootPath()}/.gitignore`;
            const gitignoreFile = Bun.file(gitignorePath);
            let gitignoreContent = "";

            if (await gitignoreFile.exists()) {
                gitignoreContent = await gitignoreFile.text();
            }

            // Add secrets.json if not already in .gitignore
            if (!gitignoreContent.includes("secrets.json")) {
                gitignoreContent += (gitignoreContent ? "\n" : "") + "secrets.json\n";
                await Bun.write(gitignorePath, gitignoreContent);
                logger.info(".gitignore updated to exclude secrets.json");
            }

            return Response.json({
                success: true,
                message: isInitialized ? "Git repo already initialized" : "Git repo initialized successfully",
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to initialize git repo", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Get current git status
export const gitStatusRoute: RouteHandler<GitStatusResponse> = {
    GET: async (_req) => {
        try {
            const git = getGitClient();
            logger.info("Getting git status", { path: getRootPath() });

            const isInitialized = await git.isRepo();

            if (!isInitialized) {
                logger.info("Git not initialized, returning early");
                return Response.json({
                    success: true,
                    initialized: false,
                    hasRemote: false,
                });
            }

            // Get current branch
            const currentBranch = await git.currentBranch();
            logger.info("Current branch", { currentBranch });

            // Check if remote exists
            const hasRemote = await git.hasRemote("origin");
            let remoteUrl: string | undefined;
            let remoteBranch: string | undefined;

            if (hasRemote) {
                remoteUrl = await git.getRemoteUrl("origin");
                // Sanitize URL for display (hide any embedded credentials)
                if (remoteUrl) {
                    remoteUrl = remoteUrl.replace(/\/\/[^@]+@github\.com/, "//***@github.com");
                }

                if (currentBranch) {
                    const upstream = await git.getUpstream(currentBranch);
                    if (upstream) {
                        remoteBranch = `${upstream.remote}/${upstream.ref}`;
                    }
                }
            }

            // Get status
            const statusResult = await git.status();
            const changedFiles = statusResult.changedFiles.length;
            const hasUncommittedChanges = statusResult.hasUncommittedChanges;

            // Check for merge conflicts
            logger.info("=== /api/git/status: checking hasMergeConflict ===");
            const hasMergeConflict = await git.hasMergeConflict();
            logger.info("=== /api/git/status: hasMergeConflict result ===", { hasMergeConflict });
            let conflictCount = 0;
            if (hasMergeConflict) {
                const conflicts = await git.getConflictFiles();
                conflictCount = conflicts.filter((c) => !c.resolved).length;
                logger.info("Conflict count from getConflictFiles", { conflictCount, totalConflicts: conflicts.length });
            }

            // Get recent commits
            const recentCommits = await git.log({ depth: 5 });

            // Build status string for compatibility
            const statusLines = statusResult.changedFiles
                .map((f) => {
                    const code = f.status === "added" ? "A" : f.status === "deleted" ? "D" : f.status === "untracked" ? "?" : "M";
                    return `${code}  ${f.path}`;
                })
                .join("\n");

            const response: GitStatusResponse = {
                success: true,
                initialized: true,
                hasRemote,
                remoteUrl,
                currentBranch,
                remoteBranch,
                status: statusLines,
                changedFiles,
                hasUncommittedChanges,
                hasMergeConflict,
                conflictCount: hasMergeConflict ? conflictCount : undefined,
                recentCommits,
            };

            logger.info("Returning git status", {
                initialized: response.initialized,
                hasRemote: response.hasRemote,
                currentBranch: response.currentBranch,
                changedFiles: response.changedFiles,
                hasMergeConflict: response.hasMergeConflict,
            });
            return Response.json(response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get git status", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    initialized: false,
                    hasRemote: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Setup remote repository
export const gitSetupRemoteRoute: RouteHandler<GitSyncResponse> = {
    POST: async (req) => {
        try {
            const { repoUrl, branch } = (await req.json()) as { repoUrl: string; branch?: string };

            if (!repoUrl) {
                return Response.json(
                    {
                        success: false,
                        error: "Repository URL is required",
                    },
                    { status: 400 }
                );
            }

            const git = getGitClient();
            const auth = getAuthConfig();
            logger.info("Setting up remote repository", { repoUrl, branch });

            const branchName = branch || "main";

            // Normalize the URL
            let normalizedUrl = repoUrl.trim();
            normalizedUrl = normalizedUrl.replace(/\.git$/, "");
            if (!normalizedUrl.endsWith(".git")) {
                normalizedUrl = `${normalizedUrl}.git`;
            }

            // Add or update remote
            await git.addRemote("origin", normalizedUrl);
            logger.info("Remote origin configured", { url: normalizedUrl });

            // Check if branch exists on remote (if we have auth)
            let remoteBranchExists = false;
            if (auth) {
                try {
                    remoteBranchExists = await git.remoteBranchExists(auth, "origin", branchName);
                } catch {
                    remoteBranchExists = false;
                }
            }

            // Get current branch
            const currentBranch = await git.currentBranch();

            // If we're not on the sync branch, create/checkout it
            if (currentBranch !== branchName) {
                try {
                    await git.createBranch(branchName);
                    logger.info(`Created branch: ${branchName}`);
                } catch {
                    // Branch might already exist
                }
                await git.checkout(branchName);
                logger.info(`Checked out branch: ${branchName}`);
            }

            // Set upstream tracking
            if (remoteBranchExists) {
                await git.setUpstream(branchName, "origin", branchName);
                logger.info(`Set upstream tracking to origin/${branchName}`);
            } else {
                logger.info(`Branch ${branchName} doesn't exist on remote, will be created on first push`);
            }

            return Response.json({
                success: true,
                message: `Remote configured successfully. Branch: ${branchName}`,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to setup remote", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Pull from remote
export const gitPullRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            const auth = getAuthConfig();
            logger.info("Pulling from remote", { path: getRootPath() });

            if (!auth) {
                return Response.json(
                    {
                        success: false,
                        error: "GitHub PAT not configured. Add it in Settings > Secrets.",
                    },
                    { status: 400 }
                );
            }

            const branch = await git.currentBranch();
            if (!branch) {
                return Response.json(
                    {
                        success: false,
                        error: "Not on any branch",
                    },
                    { status: 400 }
                );
            }

            // Check if remote branch exists
            const remoteBranchExists = await git.remoteBranchExists(auth, "origin", branch);
            if (!remoteBranchExists) {
                logger.info("Remote branch doesn't exist (empty repo), skipping pull", { branch });
                return Response.json({
                    success: true,
                    message: "No remote branch yet, skipping pull",
                });
            }

            try {
                const result = await git.pull(auth, "origin", branch);

                if (result.hadConflicts) {
                    // Conflicts detected - files have conflict markers written
                    logger.info("Pull completed with conflicts", { conflictFiles: result.conflictFiles });
                    return Response.json(
                        {
                            success: false,
                            error: "Merge conflict detected. Please resolve conflicts before syncing.",
                            hadConflicts: true,
                            conflictFiles: result.conflictFiles,
                        },
                        { status: 409 } // Conflict status code
                    );
                }

                logger.info("Pulled successfully from remote");
                return Response.json({
                    success: true,
                    message: "Changes pulled successfully",
                });
            } catch (error) {
                const errorMessage = String(error);
                logger.error("Failed to pull", { error: errorMessage });

                // Parse common errors
                let friendlyError = errorMessage;
                if (errorMessage.includes("Authentication") || errorMessage.includes("401")) {
                    friendlyError = "Authentication failed. Check your GitHub PAT in Settings > Secrets.";
                } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
                    friendlyError = "Repository not found. Check the remote URL.";
                }

                return Response.json(
                    {
                        success: false,
                        error: friendlyError,
                    },
                    { status: 500 }
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to pull from remote", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Commit local changes (stage and commit, no push)
export const gitCommitRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            logger.info("Committing local changes", { path: getRootPath() });

            // Stage all changes
            await git.addAll();
            logger.info("Staged all changes");

            // Check if there are changes to commit
            const hasStagedChanges = await git.hasStagedChanges();

            if (hasStagedChanges) {
                const commitMessage = `Sync from Nomendex - ${new Date().toISOString()}`;
                const sha = await git.commit(commitMessage);
                logger.info("Changes committed", { sha: sha.slice(0, 7) });

                return Response.json({
                    success: true,
                    message: "Changes committed",
                });
            } else {
                logger.info("No changes to commit");
                return Response.json({
                    success: true,
                    message: "No changes to commit",
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to commit", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Push to remote
export const gitPushRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            const auth = getAuthConfig();
            logger.info("Pushing to remote", { path: getRootPath() });

            if (!auth) {
                return Response.json(
                    {
                        success: false,
                        error: "GitHub PAT not configured. Add it in Settings > Secrets.",
                    },
                    { status: 400 }
                );
            }

            const branch = await git.currentBranch();
            if (!branch) {
                return Response.json(
                    {
                        success: false,
                        error: "Not on any branch",
                    },
                    { status: 400 }
                );
            }

            // Stage all changes
            await git.addAll();
            logger.info("Staged all changes");

            // Check if there are changes to commit
            const hasStagedChanges = await git.hasStagedChanges();
            let hasChanges = false;

            if (hasStagedChanges) {
                const commitMessage = `Sync from Nomendex - ${new Date().toISOString()}`;
                await git.commit(commitMessage);
                logger.info("Changes committed");
                hasChanges = true;
            }

            // Check if remote branch exists
            const remoteBranchExists = await git.remoteBranchExists(auth, "origin", branch);

            try {
                await git.push(auth, "origin", branch);

                // Set upstream tracking after successful push
                if (!remoteBranchExists) {
                    await git.setUpstream(branch, "origin", branch);
                    logger.info("Set upstream tracking");
                }

                logger.info("Pushed successfully to remote");
                return Response.json({
                    success: true,
                    message: hasChanges ? "Changes committed and pushed successfully" : "Pushed successfully (no new commits)",
                });
            } catch (error) {
                const errorMessage = String(error);
                logger.error("Failed to push", { error: errorMessage });

                // Parse common errors
                let friendlyError = errorMessage;
                if (errorMessage.includes("non-fast-forward") || errorMessage.includes("rejected")) {
                    friendlyError = "Push rejected. The remote has changes you don't have locally. Try pulling first.";
                } else if (errorMessage.includes("Authentication") || errorMessage.includes("401")) {
                    friendlyError = "Authentication failed. Check your GitHub PAT in Settings > Secrets.";
                } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
                    friendlyError = "Repository not found. Check the remote URL.";
                } else if (errorMessage.includes("403")) {
                    friendlyError = "Permission denied. Check your repository access permissions.";
                }

                return Response.json(
                    {
                        success: false,
                        error: friendlyError,
                    },
                    { status: 500 }
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to push to remote", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

interface IncomingFile {
    status: string;
    path: string;
}

interface GitFetchStatusResponse {
    success: boolean;
    behindCount: number;
    aheadCount: number;
    incomingCommits: CommitInfo[];
    incomingFiles: IncomingFile[];
    error?: string;
}

// Fetch from remote and check for incoming changes
export const gitFetchStatusRoute: RouteHandler<GitFetchStatusResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            const auth = getAuthConfig();
            logger.info("Fetching status from remote", { path: getRootPath() });

            if (!auth) {
                return Response.json(
                    {
                        success: false,
                        behindCount: 0,
                        aheadCount: 0,
                        incomingCommits: [],
                        incomingFiles: [],
                        error: "GitHub PAT not configured. Add it in Settings > Secrets.",
                    },
                    { status: 400 }
                );
            }

            const branch = await git.currentBranch();
            if (!branch) {
                return Response.json(
                    {
                        success: false,
                        behindCount: 0,
                        aheadCount: 0,
                        incomingCommits: [],
                        incomingFiles: [],
                        error: "Not on any branch",
                    },
                    { status: 400 }
                );
            }

            // Check if remote branch exists
            const remoteBranchExists = await git.remoteBranchExists(auth, "origin", branch);
            if (!remoteBranchExists) {
                logger.info("Remote branch doesn't exist (empty repo)", { branch });
                return Response.json({
                    success: true,
                    behindCount: 0,
                    aheadCount: 0,
                    incomingCommits: [],
                    incomingFiles: [],
                });
            }

            try {
                const result = await git.getFetchStatus(auth, branch);
                logger.info("Fetch status complete", {
                    behindCount: result.behindCount,
                    aheadCount: result.aheadCount,
                });

                return Response.json({
                    success: true,
                    ...result,
                });
            } catch (error) {
                const errorMessage = String(error);
                logger.error("Failed to get fetch status", { error: errorMessage });

                // Parse common errors
                let friendlyError = errorMessage;
                if (errorMessage.includes("Authentication") || errorMessage.includes("401")) {
                    friendlyError = "Authentication failed. Check your GitHub PAT in Settings > Secrets.";
                } else if (errorMessage.includes("Could not resolve host") || errorMessage.includes("network")) {
                    friendlyError = "Network error. Could not connect to remote repository.";
                }

                return Response.json(
                    {
                        success: false,
                        behindCount: 0,
                        aheadCount: 0,
                        incomingCommits: [],
                        incomingFiles: [],
                        error: friendlyError,
                    },
                    { status: 500 }
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get fetch status", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    behindCount: 0,
                    aheadCount: 0,
                    incomingCommits: [],
                    incomingFiles: [],
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

interface GitConflictsResponse {
    success: boolean;
    hasMergeConflict: boolean;
    conflictFiles: ConflictFile[];
    error?: string;
}

// Get merge conflict status and conflicting files
export const gitConflictsRoute: RouteHandler<GitConflictsResponse> = {
    GET: async (_req) => {
        try {
            const git = getGitClient();
            const rootPath = getRootPath();
            logger.info("=== /api/git/conflicts called ===", { path: rootPath });

            // Log the git directory being used
            const gitDir = `${rootPath}/.git`;
            const mergeStatePath = `${gitDir}/NOMENDEX_MERGE_STATE`;
            const mergeHeadPath = `${gitDir}/MERGE_HEAD`;

            // Check if files exist
            const mergeStateExists = await Bun.file(mergeStatePath).exists();
            const mergeHeadExists = await Bun.file(mergeHeadPath).exists();
            logger.info("Conflict file check", {
                gitDir,
                mergeStateExists,
                mergeStatePath,
                mergeHeadExists,
                mergeHeadPath
            });

            const hasMergeConflict = await git.hasMergeConflict();
            logger.info("hasMergeConflict result", { hasMergeConflict });

            if (!hasMergeConflict) {
                logger.info("No merge conflict, returning empty list");
                return Response.json({
                    success: true,
                    hasMergeConflict: false,
                    conflictFiles: [],
                });
            }

            const conflictFiles = await git.getConflictFiles();
            logger.info("=== /api/git/conflicts complete ===", { hasMergeConflict, conflictCount: conflictFiles.length, files: conflictFiles.map(f => f.path) });

            return Response.json({
                success: true,
                hasMergeConflict,
                conflictFiles,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to check conflicts", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    hasMergeConflict: false,
                    conflictFiles: [],
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Resolve a specific file conflict
export const gitResolveConflictRoute: RouteHandler<GitSyncResponse> = {
    POST: async (req) => {
        try {
            const { filePath, resolution } = (await req.json()) as {
                filePath: string;
                resolution: "ours" | "theirs" | "mark-resolved";
            };

            if (!filePath) {
                return Response.json(
                    {
                        success: false,
                        error: "File path is required",
                    },
                    { status: 400 }
                );
            }

            if (!resolution || !["ours", "theirs", "mark-resolved"].includes(resolution)) {
                return Response.json(
                    {
                        success: false,
                        error: "Resolution must be 'ours', 'theirs', or 'mark-resolved'",
                    },
                    { status: 400 }
                );
            }

            const git = getGitClient();
            logger.info("Resolving conflict", { filePath, resolution });

            await git.resolveConflict(filePath, resolution);

            return Response.json({
                success: true,
                message: `Resolved ${filePath} with '${resolution}'`,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to resolve conflict", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Abort the current merge
export const gitAbortMergeRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            logger.info("Aborting merge", { path: getRootPath() });

            const hasMerge = await git.hasMergeConflict();
            if (!hasMerge) {
                return Response.json({
                    success: true,
                    message: "No merge in progress",
                });
            }

            await git.abortMerge();

            return Response.json({
                success: true,
                message: "Merge aborted successfully",
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to abort merge", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

// Continue merge after resolving all conflicts
export const gitContinueMergeRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            const git = getGitClient();
            logger.info("Continuing merge", { path: getRootPath() });

            // Use the new completeMerge function which handles everything:
            // - Checks for unresolved conflicts
            // - Stages all files
            // - Creates proper merge commit with both parents
            // - Cleans up merge state
            await git.completeMerge();

            logger.info("Merge completed successfully");

            return Response.json({
                success: true,
                message: "Merge completed successfully",
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check for specific errors
            if (errorMessage.includes("unresolved conflicts")) {
                return Response.json(
                    {
                        success: false,
                        error: errorMessage,
                    },
                    { status: 400 }
                );
            }

            if (errorMessage.includes("No merge in progress")) {
                return Response.json({
                    success: true,
                    message: "No merge in progress",
                });
            }

            logger.error("Failed to continue merge", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};

interface ConflictContentResponse {
    success: boolean;
    filePath: string;
    oursContent: string;
    theirsContent: string;
    mergedContent: string;
    error?: string;
}

// Get the content of a conflicting file (ours, theirs, and merged)
export const gitConflictContentRoute: RouteHandler<ConflictContentResponse> = {
    GET: async (req) => {
        try {
            const url = new URL(req.url);
            const filePath = url.searchParams.get("path");

            if (!filePath) {
                return Response.json(
                    {
                        success: false,
                        filePath: "",
                        oursContent: "",
                        theirsContent: "",
                        mergedContent: "",
                        error: "File path is required",
                    },
                    { status: 400 }
                );
            }

            const git = getGitClient();
            logger.info("Getting conflict content", { filePath });

            const content = await git.getConflictContent(filePath);

            logger.info("Conflict content retrieved", {
                filePath,
                oursLength: content.oursContent.length,
                theirsLength: content.theirsContent.length,
                mergedLength: content.mergedContent.length,
            });

            return Response.json({
                success: true,
                filePath,
                ...content,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get conflict content", { error: errorMessage });
            return Response.json(
                {
                    success: false,
                    filePath: "",
                    oursContent: "",
                    theirsContent: "",
                    mergedContent: "",
                    error: errorMessage,
                },
                { status: 500 }
            );
        }
    },
};
