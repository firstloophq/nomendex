import { RouteHandler } from "../types/Routes";
import { getRootPath } from "../storage/root-path";
import { $ } from "bun";
import { createServiceLogger } from "../lib/logger";

const logger = createServiceLogger("GIT-SYNC");

// Augment PATH for GUI app context (macOS GUI apps don't inherit shell PATH)
// This ensures git is found in common Homebrew locations
const EXTRA_PATHS = [
    "/opt/homebrew/bin",  // Homebrew on Apple Silicon
    "/usr/local/bin",     // Homebrew on Intel Mac
];
const currentPath = process.env.PATH || "";
const pathsToAdd = EXTRA_PATHS.filter(p => !currentPath.includes(p));
if (pathsToAdd.length > 0) {
    process.env.PATH = `${pathsToAdd.join(":")}:${currentPath}`;
    logger.info("Augmented PATH for git discovery", { added: pathsToAdd });
}

// Get GitHub PAT from environment (loaded from secrets)
function getGitHubPAT(): string | undefined {
    const pat = process.env.GITHUB_PAT;
    // Trim whitespace and validate
    if (pat) {
        const trimmed = pat.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return undefined;
}

// Inject PAT into HTTPS GitHub URL for authentication
function injectPATIntoUrl(url: string, pat: string): string {
    // GitHub PATs are alphanumeric with underscores, safe for URLs
    // Use x-access-token as username (GitHub convention)
    // Handle: https://github.com/... → https://x-access-token:<PAT>@github.com/...
    return url
        .replace(/^https:\/\/[^@]*@github\.com/, `https://x-access-token:${pat}@github.com`)
        .replace(/^https:\/\/github\.com/, `https://x-access-token:${pat}@github.com`);
}

// Get the authenticated remote URL (with PAT if available)
async function getAuthenticatedRemoteUrl(): Promise<string | null> {
    try {
        const urlResult = await $`cd ${getRootPath()} && git remote get-url origin`.text();
        const url = urlResult.trim();
        if (!url) return null;

        const pat = getGitHubPAT();
        if (pat && url.startsWith("https://")) {
            const authUrl = injectPATIntoUrl(url, pat);
            // Log sanitized URL for debugging (hide PAT)
            logger.info("Generated auth URL", {
                originalUrl: url,
                hasAuth: authUrl.includes("@"),
                patLength: pat.length
            });
            return authUrl;
        }
        return url;
    } catch (error) {
        logger.error("Failed to get remote URL", { error: String(error) });
        return null;
    }
}

interface CommitInfo {
    hash: string;
    message: string;
    author: string;
    date: string;
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

// Check if git is installed on the system
interface GitInstalledResponse {
    success: boolean;
    installed: boolean;
    version?: string;
    error?: string;
}

export const gitInstalledRoute: RouteHandler<GitInstalledResponse> = {
    GET: async (_req) => {
        try {
            logger.info("Checking if git is installed");

            // Use 'which git' to check if git is in PATH (PATH is augmented at module load)
            const whichResult = await $`which git 2>&1`.nothrow();

            if (whichResult.exitCode !== 0) {
                logger.info("Git not found in PATH");
                return Response.json({
                    success: true,
                    installed: false
                });
            }

            const gitPath = whichResult.text().trim();

            // Git is installed, get version
            const versionResult = await $`git --version 2>&1`.nothrow();
            let version: string | undefined;
            if (versionResult.exitCode === 0) {
                // Parse "git version 2.39.0" -> "2.39.0"
                const match = versionResult.text().match(/git version (\S+)/);
                version = match ? match[1] : undefined;
            }

            logger.info("Git is installed", { version, path: gitPath });

            return Response.json({
                success: true,
                installed: true,
                version
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Error checking git installation", { error: errorMessage });
            return Response.json({
                success: false,
                installed: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Initialize git repo and ensure .gitignore exists
export const gitInitRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            logger.info("Initializing git repo", { path: getRootPath() });

            // Check if git repo already exists
            const gitDir = `${getRootPath()}/.git`;
            const gitDirFile = Bun.file(gitDir);
            const isInitialized = await gitDirFile.exists();

            if (!isInitialized) {
                // Initialize git repo
                const initResult = await $`cd ${getRootPath()} && git init 2>&1`.nothrow();
                if (initResult.exitCode !== 0) {
                    const output = initResult.text().trim();
                    logger.error("Git init failed", { exitCode: initResult.exitCode, output });

                    // Provide helpful error messages for common issues
                    let friendlyError = output || `Git init failed with exit code ${initResult.exitCode}`;
                    if (initResult.exitCode === 69) {
                        friendlyError = "Git is unavailable. You may need to install Xcode Command Line Tools by running 'xcode-select --install' in Terminal.";
                    } else if (initResult.exitCode === 128) {
                        friendlyError = "Git permission denied or directory issue. Check that the workspace folder exists and is writable.";
                    }

                    return Response.json({
                        success: false,
                        error: friendlyError
                    }, { status: 500 });
                }
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
                message: isInitialized ? "Git repo already initialized" : "Git repo initialized successfully"
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to initialize git repo", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Get current git status
export const gitStatusRoute: RouteHandler<GitStatusResponse> = {
    GET: async (_req) => {
        try {
            logger.info("Getting git status", { path: getRootPath() });

            // Check if git repo exists - need to check for .git/HEAD file instead of directory
            const gitHeadFile = `${getRootPath()}/.git/HEAD`;
            logger.info("Checking if git is initialized", { gitHeadFile });

            let isInitialized = false;
            try {
                const headFile = Bun.file(gitHeadFile);
                isInitialized = await headFile.exists();
                logger.info("Git initialization check result", { isInitialized, gitHeadFile });
            } catch (error) {
                logger.error("Error checking git initialization", { error: String(error) });
                isInitialized = false;
            }

            if (!isInitialized) {
                logger.info("Git not initialized, returning early");
                return Response.json({
                    success: true,
                    initialized: false,
                    hasRemote: false
                });
            }

            // Get current branch
            logger.info("Getting current branch");
            const branchResult = await $`cd ${getRootPath()} && git branch --show-current`.text();
            const currentBranch = branchResult.trim();
            logger.info("Current branch", { currentBranch });

            // Check if remote exists and get URL
            logger.info("Checking for remote");
            let hasRemote = false;
            let remoteUrl = "";
            let remoteBranch = "";
            try {
                const remoteResult = await $`cd ${getRootPath()} && git remote -v`.text();
                hasRemote = remoteResult.trim().length > 0;
                logger.info("Remote check", { hasRemote, remoteOutput: remoteResult.trim() });

                if (hasRemote) {
                    // Get the origin URL (sanitize the PAT if present)
                    try {
                        const urlResult = await $`cd ${getRootPath()} && git remote get-url origin`.text();
                        const url = urlResult.trim();
                        // Remove PAT from URL for display
                        remoteUrl = url.replace(/\/\/[^@]+@github\.com/, "//***@github.com");
                        logger.info("Remote URL retrieved", { remoteUrl });
                    } catch (error) {
                        logger.error("Failed to get remote URL", { error: String(error) });
                    }

                    if (currentBranch) {
                        // Try to get tracking branch
                        try {
                            const trackingResult = await $`cd ${getRootPath()} && git rev-parse --abbrev-ref ${currentBranch}@{upstream}`.text();
                            remoteBranch = trackingResult.trim();
                            logger.info("Tracking branch", { remoteBranch });
                        } catch (error) {
                            logger.info("No tracking branch set", { error: String(error) });
                        }
                    }
                }
            } catch (error) {
                logger.error("Error checking remote", { error: String(error) });
                hasRemote = false;
            }

            // Get status
            logger.info("Getting git status");
            const statusResult = await $`cd ${getRootPath()} && git status --short`.text();
            const statusLines = statusResult.trim().split("\n").filter(line => line.trim().length > 0);
            const changedFiles = statusLines.length;
            const hasUncommittedChanges = changedFiles > 0;
            logger.info("Git status retrieved", { changedFiles, hasUncommittedChanges });

            // Check for merge conflicts
            const mergeHeadFile = Bun.file(`${getRootPath()}/.git/MERGE_HEAD`);
            const hasMergeConflict = await mergeHeadFile.exists();
            let conflictCount = 0;

            if (hasMergeConflict) {
                // Count conflicting files
                conflictCount = statusLines.filter(line => {
                    const statusCode = line.substring(0, 2);
                    return statusCode === "UU" || statusCode === "DU" ||
                           statusCode === "UD" || statusCode === "AA";
                }).length;
                logger.info("Merge conflict detected", { conflictCount });
            }

            // Get recent commits (last 5)
            let recentCommits: CommitInfo[] = [];
            try {
                const logResult = await $`cd ${getRootPath()} && git log -5 --pretty=format:%H|%s|%an|%ar`.text();
                if (logResult.trim()) {
                    recentCommits = logResult.trim().split("\n").map(line => {
                        const [hash, message, author, date] = line.split("|");
                        return {
                            hash: hash?.slice(0, 7) || "",
                            message: message || "",
                            author: author || "",
                            date: date || ""
                        };
                    });
                }
                logger.info("Recent commits retrieved", { count: recentCommits.length });
            } catch (error) {
                logger.info("No commits yet or failed to get commits", { error: String(error) });
            }

            const response = {
                success: true,
                initialized: true,
                hasRemote,
                remoteUrl: remoteUrl || undefined,
                currentBranch: currentBranch || undefined,
                remoteBranch: remoteBranch || undefined,
                status: statusResult.trim(),
                changedFiles,
                hasUncommittedChanges,
                hasMergeConflict,
                conflictCount: hasMergeConflict ? conflictCount : undefined,
                recentCommits
            };

            logger.info("Returning git status", response);
            return Response.json(response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get git status", { error: errorMessage });
            return Response.json({
                success: false,
                initialized: false,
                hasRemote: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Setup remote repository
export const gitSetupRemoteRoute: RouteHandler<GitSyncResponse> = {
    POST: async (req) => {
        try {
            const { repoUrl, branch } = await req.json() as { repoUrl: string; branch?: string };

            if (!repoUrl) {
                return Response.json({
                    success: false,
                    error: "Repository URL is required"
                }, { status: 400 });
            }

            logger.info("Setting up remote repository", { repoUrl, branch });

            const branchName = branch || "main";

            // Normalize the URL (support both HTTPS and SSH formats)
            let normalizedUrl = repoUrl.trim();
            // Remove trailing .git if present, we'll add it back
            normalizedUrl = normalizedUrl.replace(/\.git$/, "");
            // Add .git suffix
            if (!normalizedUrl.endsWith(".git")) {
                normalizedUrl = `${normalizedUrl}.git`;
            }

            // Check if remote already exists
            try {
                const remoteResult = await $`cd ${getRootPath()} && git remote get-url origin`.text();
                if (remoteResult.trim()) {
                    // Remote exists, update it
                    await $`cd ${getRootPath()} && git remote set-url origin ${normalizedUrl}`.quiet();
                    logger.info("Updated existing remote origin");
                }
            } catch {
                // Remote doesn't exist, add it
                await $`cd ${getRootPath()} && git remote add origin ${normalizedUrl}`.quiet();
                logger.info("Added remote origin");
            }

            // Check if branch exists on remote (use PAT if available for private repos)
            let remoteBranchExists = false;
            try {
                const pat = getGitHubPAT();
                const lsRemoteUrl = pat && normalizedUrl.startsWith("https://")
                    ? injectPATIntoUrl(normalizedUrl, pat)
                    : normalizedUrl;
                const lsResult = await $`cd ${getRootPath()} && git ls-remote --heads ${lsRemoteUrl} ${branchName}`.text();
                remoteBranchExists = lsResult.trim().length > 0;
            } catch {
                remoteBranchExists = false;
            }

            // Get current branch
            const currentBranch = await $`cd ${getRootPath()} && git branch --show-current`.text();
            const currentBranchTrimmed = currentBranch.trim();

            // If we're not on the sync branch, create/checkout it
            if (currentBranchTrimmed !== branchName) {
                try {
                    await $`cd ${getRootPath()} && git checkout -b ${branchName}`.quiet();
                    logger.info(`Created and checked out branch: ${branchName}`);
                } catch {
                    // Branch might already exist locally
                    await $`cd ${getRootPath()} && git checkout ${branchName}`.quiet();
                    logger.info(`Checked out existing branch: ${branchName}`);
                }
            }

            // If branch doesn't exist on remote, we'll need to push it
            if (!remoteBranchExists) {
                logger.info(`Branch ${branchName} doesn't exist on remote, will be created on first push`);
            }

            // Set upstream tracking
            try {
                await $`cd ${getRootPath()} && git branch --set-upstream-to=origin/${branchName} ${branchName}`.quiet();
                logger.info(`Set upstream tracking to origin/${branchName}`);
            } catch {
                // Upstream might not exist yet if we haven't pushed
                logger.info("Upstream tracking will be set after first push");
            }

            return Response.json({
                success: true,
                message: `Remote configured successfully. Branch: ${branchName}`
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to setup remote", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Check if the remote branch exists
async function remoteBranchExists(branch: string): Promise<boolean> {
    try {
        const authUrl = await getAuthenticatedRemoteUrl();
        const targetUrl = authUrl || "origin";

        const lsResult = await $`cd ${getRootPath()} && git ls-remote --heads ${targetUrl} ${branch} 2>&1`.nothrow();

        logger.info("Remote branch check", {
            branch,
            exitCode: lsResult.exitCode,
            output: lsResult.text().substring(0, 100),
            hasOutput: lsResult.text().trim().length > 0
        });

        return lsResult.exitCode === 0 && lsResult.text().trim().length > 0;
    } catch (error) {
        logger.error("Failed to check remote branch", { error: String(error) });
        return false;
    }
}

// Pull from remote
export const gitPullRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            logger.info("Pulling from remote", { path: getRootPath() });

            // Get current branch
            const currentBranch = await $`cd ${getRootPath()} && git branch --show-current`.text();
            const branch = currentBranch.trim();

            if (!branch) {
                return Response.json({
                    success: false,
                    error: "Not on any branch"
                }, { status: 400 });
            }

            // Check if remote branch exists - if not, this is an empty repo, skip pull
            const remoteExists = await remoteBranchExists(branch);
            if (!remoteExists) {
                logger.info("Remote branch doesn't exist (empty repo), skipping pull", { branch });
                return Response.json({
                    success: true,
                    message: "No remote branch yet, skipping pull"
                });
            }

            // Get authenticated URL (with PAT if available)
            const authUrl = await getAuthenticatedRemoteUrl();

            // Pull changes using authenticated URL if available - capture output for error handling
            let pullResult;
            if (authUrl) {
                pullResult = await $`cd ${getRootPath()} && git pull ${authUrl} ${branch} 2>&1`.nothrow();
            } else {
                pullResult = await $`cd ${getRootPath()} && git pull origin ${branch} 2>&1`.nothrow();
            }

            if (pullResult.exitCode !== 0) {
                const pullError = pullResult.text().trim();
                logger.error("Failed to pull", { exitCode: pullResult.exitCode, error: pullError });

                // Parse common git pull errors for user-friendly messages
                let friendlyError = pullError;
                if (pullError.includes("CONFLICT") || pullError.includes("conflict")) {
                    friendlyError = "Merge conflict detected. Please resolve conflicts manually before syncing.";
                } else if (pullError.includes("Your local changes") && pullError.includes("would be overwritten")) {
                    friendlyError = "You have uncommitted local changes that would be overwritten. Commit or stash them first.";
                } else if (pullError.includes("Authentication failed") || pullError.includes("could not read Username")) {
                    friendlyError = "Authentication failed. Check your GitHub PAT in Settings > Secrets.";
                } else if (pullError.includes("Permission denied")) {
                    friendlyError = "Permission denied. Check your repository access permissions.";
                } else if (pullError.includes("Repository not found")) {
                    friendlyError = "Repository not found. Check the remote URL.";
                } else if (pullError.includes("Couldn't find remote ref")) {
                    // This shouldn't happen now since we check first, but handle gracefully
                    logger.info("Remote ref not found, treating as empty repo");
                    return Response.json({
                        success: true,
                        message: "No remote branch yet, skipping pull"
                    });
                } else if (!pullError) {
                    friendlyError = `Pull failed with exit code ${pullResult.exitCode}`;
                }

                return Response.json({
                    success: false,
                    error: friendlyError
                }, { status: 500 });
            }

            logger.info("Pulled successfully from remote");

            return Response.json({
                success: true,
                message: "Changes pulled successfully"
            });
        } catch (error) {
            const errorMessage = extractGitError(error);
            logger.error("Failed to pull from remote", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Helper to extract meaningful error message from git command failure
function extractGitError(error: unknown): string {
    if (error instanceof Error) {
        const msg = error.message;
        // Check for common git error patterns and provide helpful messages
        if (msg.includes("exit code 128")) {
            // Authentication or permission errors
            if (msg.includes("Authentication failed") || msg.includes("could not read Username")) {
                return "Authentication failed. Check your GitHub PAT or credentials.";
            }
            if (msg.includes("Permission denied")) {
                return "Permission denied. Check your repository access permissions.";
            }
            if (msg.includes("Repository not found")) {
                return "Repository not found. Check the remote URL.";
            }
            return "Git operation failed (exit code 128). This usually indicates an authentication or access issue.";
        }
        if (msg.includes("exit code 1")) {
            // Check stderr content if available
            const stderrMatch = msg.match(/stderr:\s*([\s\S]*?)(?:\n\n|$)/i);
            if (stderrMatch && stderrMatch[1]?.trim()) {
                return stderrMatch[1].trim();
            }
            // Common exit code 1 scenarios
            if (msg.includes("conflict")) {
                return "Merge conflict detected. Please resolve conflicts manually.";
            }
            if (msg.includes("rejected")) {
                return "Push rejected. The remote has changes you don't have locally. Try pulling first.";
            }
            if (msg.includes("non-fast-forward")) {
                return "Push rejected (non-fast-forward). Pull the latest changes first.";
            }
        }
        return msg;
    }
    return String(error);
}

// Commit local changes (stage and commit, no push)
export const gitCommitRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            logger.info("Committing local changes", { path: getRootPath() });

            // Stage all changes first
            const stageResult = await $`cd ${getRootPath()} && git add -A 2>&1`.nothrow();
            if (stageResult.exitCode !== 0) {
                const stageError = stageResult.text();
                logger.error("Failed to stage changes", { error: stageError });
                return Response.json({
                    success: false,
                    error: `Failed to stage changes: ${stageError.trim() || "Unknown error"}`
                }, { status: 500 });
            }
            logger.info("Staged all changes");

            // Check if there are changes to commit
            const statusResult = await $`cd ${getRootPath()} && git diff --cached --stat`.text();
            const hasChanges = statusResult.trim().length > 0;

            if (hasChanges) {
                // Create commit with timestamp-based message
                const commitMessage = `Sync from Noetect - ${new Date().toISOString()}`;
                logger.info("Creating commit", { commitMessage });

                // Commit changes - capture any errors
                const commitResult = await $`cd ${getRootPath()} && git commit -m ${commitMessage} 2>&1`.nothrow();
                if (commitResult.exitCode !== 0) {
                    const commitError = commitResult.text();
                    logger.error("Failed to commit", { error: commitError });
                    return Response.json({
                        success: false,
                        error: `Failed to commit: ${commitError.trim() || "Unknown error"}`
                    }, { status: 500 });
                }
                logger.info("Changes committed", { message: commitMessage });

                return Response.json({
                    success: true,
                    message: "Changes committed"
                });
            } else {
                logger.info("No changes to commit");
                return Response.json({
                    success: true,
                    message: "No changes to commit"
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to commit", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Push to remote
export const gitPushRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            logger.info("Pushing to remote", { path: getRootPath() });

            // Get current branch
            const currentBranch = await $`cd ${getRootPath()} && git branch --show-current`.text();
            const branch = currentBranch.trim();

            if (!branch) {
                return Response.json({
                    success: false,
                    error: "Not on any branch"
                }, { status: 400 });
            }

            // Stage all changes first
            const stageResult = await $`cd ${getRootPath()} && git add -A 2>&1`.nothrow();
            if (stageResult.exitCode !== 0) {
                const stageError = stageResult.text();
                logger.error("Failed to stage changes", { error: stageError });
                return Response.json({
                    success: false,
                    error: `Failed to stage changes: ${stageError.trim() || "Unknown error"}`
                }, { status: 500 });
            }
            logger.info("Staged all changes");

            // Check if there are changes to commit
            const statusResult = await $`cd ${getRootPath()} && git diff --cached --stat`.text();
            const hasChanges = statusResult.trim().length > 0;

            if (hasChanges) {
                // Create commit with timestamp-based message
                const commitMessage = `Sync from MCP Client - ${new Date().toISOString()}`;
                logger.info("Creating commit", { commitMessage });

                // Commit changes - capture any errors
                const commitResult = await $`cd ${getRootPath()} && git commit -m ${commitMessage} 2>&1`.nothrow();
                if (commitResult.exitCode !== 0) {
                    const commitError = commitResult.text();
                    logger.error("Failed to commit", { error: commitError });
                    return Response.json({
                        success: false,
                        error: `Failed to commit: ${commitError.trim() || "Unknown error"}`
                    }, { status: 500 });
                }
                logger.info("Changes committed", { message: commitMessage });
            } else {
                logger.info("No changes to commit");
            }

            // Get authenticated URL (with PAT if available)
            const authUrl = await getAuthenticatedRemoteUrl();

            // Check if remote branch exists (empty repo check)
            const remoteHasBranch = await remoteBranchExists(branch);
            logger.info("Remote branch check", { branch, exists: remoteHasBranch });

            // Check if upstream is set
            let hasUpstream = false;
            try {
                await $`cd ${getRootPath()} && git rev-parse --abbrev-ref ${branch}@{upstream}`.text();
                hasUpstream = true;
            } catch {
                hasUpstream = false;
            }

            // Push changes using authenticated URL if available
            let pushResult;
            if (authUrl) {
                // For empty repos or first push, use HEAD:branch syntax to create the branch
                if (!remoteHasBranch) {
                    logger.info("Remote branch doesn't exist, doing initial push");
                    pushResult = await $`cd ${getRootPath()} && git push ${authUrl} HEAD:${branch} 2>&1`.nothrow();
                } else {
                    pushResult = await $`cd ${getRootPath()} && git push ${authUrl} ${branch} 2>&1`.nothrow();
                }
                if (pushResult.exitCode === 0 && !hasUpstream) {
                    // Set upstream tracking after successful push
                    try {
                        await $`cd ${getRootPath()} && git branch --set-upstream-to=origin/${branch} ${branch}`.quiet();
                        logger.info("Set upstream tracking");
                    } catch {
                        // Ignore if upstream can't be set
                    }
                }
            } else {
                if (hasUpstream) {
                    pushResult = await $`cd ${getRootPath()} && git push 2>&1`.nothrow();
                } else {
                    pushResult = await $`cd ${getRootPath()} && git push -u origin ${branch} 2>&1`.nothrow();
                }
            }

            if (pushResult.exitCode !== 0) {
                const pushError = pushResult.text().trim();
                logger.error("Failed to push", { exitCode: pushResult.exitCode, error: pushError });

                // Parse common git push errors for user-friendly messages
                let friendlyError = pushError;
                if (pushError.includes("rejected") || pushError.includes("non-fast-forward")) {
                    friendlyError = "Push rejected. The remote has changes you don't have locally. Try pulling first.";
                } else if (pushError.includes("Authentication failed") || pushError.includes("could not read Username")) {
                    friendlyError = "Authentication failed. Check your GitHub PAT in Settings > Secrets.";
                } else if (pushError.includes("Permission denied")) {
                    friendlyError = "Permission denied. Check your repository access permissions.";
                } else if (pushError.includes("Repository not found")) {
                    friendlyError = "Repository not found. Check the remote URL.";
                } else if (pushError.includes("src refspec") && pushError.includes("does not match any")) {
                    friendlyError = "No commits to push. Make some changes first.";
                } else if (!pushError) {
                    friendlyError = `Push failed with exit code ${pushResult.exitCode}`;
                }

                return Response.json({
                    success: false,
                    error: friendlyError
                }, { status: 500 });
            }

            logger.info("Pushed successfully to remote");

            return Response.json({
                success: true,
                message: hasChanges ? "Changes committed and pushed successfully" : "No changes to push"
            });
        } catch (error) {
            const errorMessage = extractGitError(error);
            logger.error("Failed to push to remote", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

interface IncomingFile {
    status: string;  // A = added, M = modified, D = deleted
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
            logger.info("Fetching status from remote", { path: getRootPath() });

            // Get current branch
            const currentBranch = await $`cd ${getRootPath()} && git branch --show-current`.text();
            const branch = currentBranch.trim();

            if (!branch) {
                return Response.json({
                    success: false,
                    behindCount: 0,
                    aheadCount: 0,
                    incomingCommits: [],
                    incomingFiles: [],
                    error: "Not on any branch"
                }, { status: 400 });
            }

            // Get authenticated URL for fetch
            const authUrl = await getAuthenticatedRemoteUrl();

            // Fetch from remote and update the remote tracking branch
            // Using refspec to ensure origin/${branch} is updated, not just FETCH_HEAD
            let fetchResult;
            if (authUrl) {
                fetchResult = await $`cd ${getRootPath()} && git fetch ${authUrl} ${branch}:refs/remotes/origin/${branch} 2>&1`.nothrow();
            } else {
                fetchResult = await $`cd ${getRootPath()} && git fetch origin ${branch}:refs/remotes/origin/${branch} 2>&1`.nothrow();
            }

            if (fetchResult.exitCode !== 0) {
                const fetchError = fetchResult.text().trim();
                logger.error("Failed to fetch from remote", { exitCode: fetchResult.exitCode, error: fetchError });

                // Parse common git fetch errors for user-friendly messages
                let friendlyError = fetchError;
                if (fetchError.includes("Authentication failed") || fetchError.includes("could not read Username")) {
                    friendlyError = "Authentication failed. Check your GitHub PAT in Settings > Secrets.";
                } else if (fetchError.includes("Permission denied")) {
                    friendlyError = "Permission denied. Check your repository access permissions.";
                } else if (fetchError.includes("Repository not found")) {
                    friendlyError = "Repository not found. Check the remote URL.";
                } else if (fetchError.includes("Couldn't find remote ref") || fetchError.includes("couldn't find remote ref")) {
                    // Empty repo - no remote branch yet, this is fine
                    logger.info("Remote branch doesn't exist (empty repo), returning empty status", { branch });
                    return Response.json({
                        success: true,
                        behindCount: 0,
                        aheadCount: 0,
                        incomingCommits: [],
                        incomingFiles: [],
                    });
                } else if (fetchError.includes("Could not resolve host")) {
                    friendlyError = "Network error. Could not connect to remote repository.";
                } else if (!fetchError) {
                    friendlyError = `Fetch failed with exit code ${fetchResult.exitCode}`;
                }

                return Response.json({
                    success: false,
                    behindCount: 0,
                    aheadCount: 0,
                    incomingCommits: [],
                    incomingFiles: [],
                    error: friendlyError
                }, { status: 500 });
            }

            logger.info("Fetched from remote successfully");

            // Check if we have an upstream tracking branch
            let hasUpstream = false;
            try {
                await $`cd ${getRootPath()} && git rev-parse --abbrev-ref ${branch}@{upstream}`.text();
                hasUpstream = true;
            } catch {
                hasUpstream = false;
            }

            if (!hasUpstream) {
                return Response.json({
                    success: true,
                    behindCount: 0,
                    aheadCount: 0,
                    incomingCommits: [],
                    incomingFiles: [],
                });
            }

            // Count commits behind (incoming)
            let behindCount = 0;
            try {
                const behindResult = await $`cd ${getRootPath()} && git rev-list HEAD..origin/${branch} --count`.text();
                behindCount = parseInt(behindResult.trim(), 10) || 0;
            } catch {
                behindCount = 0;
            }

            // Count commits ahead (outgoing)
            let aheadCount = 0;
            try {
                const aheadResult = await $`cd ${getRootPath()} && git rev-list origin/${branch}..HEAD --count`.text();
                aheadCount = parseInt(aheadResult.trim(), 10) || 0;
            } catch {
                aheadCount = 0;
            }

            // Get incoming commits
            let incomingCommits: CommitInfo[] = [];
            if (behindCount > 0) {
                try {
                    const logResult = await $`cd ${getRootPath()} && git log HEAD..origin/${branch} --pretty=format:%H|%s|%an|%ar`.text();
                    if (logResult.trim()) {
                        incomingCommits = logResult.trim().split("\n").map(line => {
                            const [hash, message, author, date] = line.split("|");
                            return {
                                hash: hash?.slice(0, 7) || "",
                                message: message || "",
                                author: author || "",
                                date: date || ""
                            };
                        });
                    }
                } catch {
                    // Ignore errors getting commits
                }
            }

            // Get incoming file changes
            let incomingFiles: IncomingFile[] = [];
            if (behindCount > 0) {
                try {
                    const diffResult = await $`cd ${getRootPath()} && git diff --name-status HEAD..origin/${branch}`.text();
                    if (diffResult.trim()) {
                        incomingFiles = diffResult.trim().split("\n").map(line => {
                            const parts = line.split("\t");
                            return {
                                status: parts[0] || "M",
                                path: parts[1] || ""
                            };
                        }).filter(f => f.path);
                    }
                } catch {
                    // Ignore errors getting file diff
                }
            }

            logger.info("Fetch status complete", { behindCount, aheadCount, incomingCommits: incomingCommits.length });

            return Response.json({
                success: true,
                behindCount,
                aheadCount,
                incomingCommits,
                incomingFiles,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get fetch status", { error: errorMessage });
            return Response.json({
                success: false,
                behindCount: 0,
                aheadCount: 0,
                incomingCommits: [],
                incomingFiles: [],
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Types for conflict handling
interface ConflictFile {
    path: string;
    status: "both_modified" | "deleted_by_us" | "deleted_by_them" | "both_added";
    resolved: boolean; // true if file no longer contains conflict markers
}

interface GitConflictsResponse {
    success: boolean;
    hasMergeConflict: boolean;
    conflictFiles: ConflictFile[];
    error?: string;
}

// Check if a file contains git conflict markers
async function hasConflictMarkers(filePath: string): Promise<boolean> {
    try {
        // Trim the file path to handle any whitespace from git status
        const cleanPath = filePath.trim();
        const fullPath = `${getRootPath()}/${cleanPath}`;
        const file = Bun.file(fullPath);
        if (!await file.exists()) {
            logger.info("File does not exist for conflict check", { fullPath });
            return false;
        }

        const content = await file.text();
        // File is unresolved if ANY conflict marker is still present
        const hasMarkers = content.includes("<<<<<<<") ||
                          content.includes("=======") ||
                          content.includes(">>>>>>>");
        logger.info("Conflict marker check", { filePath: cleanPath, hasMarkers, contentLength: content.length });
        return hasMarkers;
    } catch (error) {
        logger.error("Error checking conflict markers", { filePath, error: String(error) });
        return false;
    }
}

// Get merge conflict status and conflicting files
export const gitConflictsRoute: RouteHandler<GitConflictsResponse> = {
    GET: async (_req) => {
        try {
            logger.info("Checking for merge conflicts", { path: getRootPath() });

            // Check if we're in a merge state
            const mergeHeadFile = Bun.file(`${getRootPath()}/.git/MERGE_HEAD`);
            const hasMergeConflict = await mergeHeadFile.exists();

            if (!hasMergeConflict) {
                return Response.json({
                    success: true,
                    hasMergeConflict: false,
                    conflictFiles: []
                });
            }

            // Get list of conflicting files using git status
            const statusResult = await $`cd ${getRootPath()} && git status --porcelain`.text();
            const conflictFiles: ConflictFile[] = [];

            for (const line of statusResult.trim().split("\n")) {
                if (!line.trim()) continue;

                const statusCode = line.substring(0, 2);
                const filePath = line.substring(3).trim(); // Trim whitespace from path

                // Conflict markers in git status:
                // UU = both modified
                // DU = deleted by us
                // UD = deleted by them
                // AA = both added
                // DD = both deleted
                let conflictStatus: ConflictFile["status"] | null = null;
                if (statusCode === "UU") {
                    conflictStatus = "both_modified";
                } else if (statusCode === "DU") {
                    conflictStatus = "deleted_by_us";
                } else if (statusCode === "UD") {
                    conflictStatus = "deleted_by_them";
                } else if (statusCode === "AA") {
                    conflictStatus = "both_added";
                }

                if (conflictStatus) {
                    // Check if file has been manually resolved (no more conflict markers)
                    const hasMarkers = await hasConflictMarkers(filePath);
                    conflictFiles.push({
                        path: filePath,
                        status: conflictStatus,
                        resolved: !hasMarkers
                    });
                }
            }

            logger.info("Conflict check complete", { hasMergeConflict, conflictCount: conflictFiles.length });

            return Response.json({
                success: true,
                hasMergeConflict,
                conflictFiles
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to check conflicts", { error: errorMessage });
            return Response.json({
                success: false,
                hasMergeConflict: false,
                conflictFiles: [],
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Resolve a specific file conflict
export const gitResolveConflictRoute: RouteHandler<GitSyncResponse> = {
    POST: async (req) => {
        try {
            const { filePath, resolution } = await req.json() as {
                filePath: string;
                resolution: "ours" | "theirs" | "mark-resolved";
            };

            if (!filePath) {
                return Response.json({
                    success: false,
                    error: "File path is required"
                }, { status: 400 });
            }

            if (!resolution || !["ours", "theirs", "mark-resolved"].includes(resolution)) {
                return Response.json({
                    success: false,
                    error: "Resolution must be 'ours', 'theirs', or 'mark-resolved'"
                }, { status: 400 });
            }

            logger.info("Resolving conflict", { filePath, resolution });

            if (resolution === "ours") {
                // Keep our version
                const result = await $`cd ${getRootPath()} && git checkout --ours ${filePath} && git add ${filePath} 2>&1`.nothrow();
                if (result.exitCode !== 0) {
                    return Response.json({
                        success: false,
                        error: `Failed to resolve with 'ours': ${result.text().trim()}`
                    }, { status: 500 });
                }
            } else if (resolution === "theirs") {
                // Keep their version
                const result = await $`cd ${getRootPath()} && git checkout --theirs ${filePath} && git add ${filePath} 2>&1`.nothrow();
                if (result.exitCode !== 0) {
                    return Response.json({
                        success: false,
                        error: `Failed to resolve with 'theirs': ${result.text().trim()}`
                    }, { status: 500 });
                }
            } else {
                // Mark as resolved (user manually edited the file)
                const result = await $`cd ${getRootPath()} && git add ${filePath} 2>&1`.nothrow();
                if (result.exitCode !== 0) {
                    return Response.json({
                        success: false,
                        error: `Failed to mark as resolved: ${result.text().trim()}`
                    }, { status: 500 });
                }
            }

            logger.info("Conflict resolved", { filePath, resolution });

            return Response.json({
                success: true,
                message: `Resolved ${filePath} with '${resolution}'`
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to resolve conflict", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Abort the current merge
export const gitAbortMergeRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            logger.info("Aborting merge", { path: getRootPath() });

            const result = await $`cd ${getRootPath()} && git merge --abort 2>&1`.nothrow();

            if (result.exitCode !== 0) {
                const errorText = result.text().trim();
                // Check if there's simply no merge to abort
                if (errorText.includes("not in the middle of a merge")) {
                    return Response.json({
                        success: true,
                        message: "No merge in progress"
                    });
                }
                return Response.json({
                    success: false,
                    error: `Failed to abort merge: ${errorText}`
                }, { status: 500 });
            }

            logger.info("Merge aborted successfully");

            return Response.json({
                success: true,
                message: "Merge aborted successfully"
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to abort merge", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Continue merge after resolving all conflicts
export const gitContinueMergeRoute: RouteHandler<GitSyncResponse> = {
    POST: async (_req) => {
        try {
            logger.info("Continuing merge", { path: getRootPath() });

            // Check if there are still unresolved conflicts
            const statusResult = await $`cd ${getRootPath()} && git status --porcelain`.text();
            const hasConflicts = statusResult.split("\n").some(line =>
                line.startsWith("UU") || line.startsWith("DU") ||
                line.startsWith("UD") || line.startsWith("AA")
            );

            if (hasConflicts) {
                return Response.json({
                    success: false,
                    error: "There are still unresolved conflicts. Resolve all conflicts before continuing."
                }, { status: 400 });
            }

            // Complete the merge with a commit
            const commitMessage = `Merge conflict resolved - ${new Date().toISOString()}`;
            const result = await $`cd ${getRootPath()} && git commit -m ${commitMessage} 2>&1`.nothrow();

            if (result.exitCode !== 0) {
                const errorText = result.text().trim();
                // If nothing to commit, merge might have already been completed
                if (errorText.includes("nothing to commit")) {
                    return Response.json({
                        success: true,
                        message: "Merge already completed"
                    });
                }
                return Response.json({
                    success: false,
                    error: `Failed to complete merge: ${errorText}`
                }, { status: 500 });
            }

            logger.info("Merge completed successfully");

            return Response.json({
                success: true,
                message: "Merge completed successfully"
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to continue merge", { error: errorMessage });
            return Response.json({
                success: false,
                error: errorMessage
            }, { status: 500 });
        }
    }
};

// Types for conflict content
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
                return Response.json({
                    success: false,
                    filePath: "",
                    oursContent: "",
                    theirsContent: "",
                    mergedContent: "",
                    error: "File path is required"
                }, { status: 400 });
            }

            logger.info("Getting conflict content", { filePath });

            const rootPath = getRootPath();

            // Get "ours" version (our local version before merge)
            let oursContent = "";
            try {
                const oursResult = await $`cd ${rootPath} && git show :2:${filePath} 2>&1`.nothrow();
                if (oursResult.exitCode === 0) {
                    oursContent = oursResult.text();
                } else {
                    // File might not exist in ours (deleted by us or new in theirs)
                    oursContent = "";
                }
            } catch {
                oursContent = "";
            }

            // Get "theirs" version (the incoming version from remote)
            let theirsContent = "";
            try {
                const theirsResult = await $`cd ${rootPath} && git show :3:${filePath} 2>&1`.nothrow();
                if (theirsResult.exitCode === 0) {
                    theirsContent = theirsResult.text();
                } else {
                    // File might not exist in theirs (deleted by them or new in ours)
                    theirsContent = "";
                }
            } catch {
                theirsContent = "";
            }

            // Get current merged content (with conflict markers)
            let mergedContent = "";
            try {
                const fullPath = `${rootPath}/${filePath}`;
                const file = Bun.file(fullPath);
                if (await file.exists()) {
                    mergedContent = await file.text();
                }
            } catch {
                mergedContent = "";
            }

            logger.info("Conflict content retrieved", {
                filePath,
                oursLength: oursContent.length,
                theirsLength: theirsContent.length,
                mergedLength: mergedContent.length
            });

            return Response.json({
                success: true,
                filePath,
                oursContent,
                theirsContent,
                mergedContent
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get conflict content", { error: errorMessage });
            return Response.json({
                success: false,
                filePath: "",
                oursContent: "",
                theirsContent: "",
                mergedContent: "",
                error: errorMessage
            }, { status: 500 });
        }
    }
};