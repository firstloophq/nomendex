import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useWorkspaceContext } from "./WorkspaceContext";
import { GitAuthMode } from "@/types/Workspace";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTeamAuth } from "@/contexts/AuthContext";

const TEAM_BACKEND_URL = "http://localhost:4444";

interface SyncStatus {
    checking: boolean;
    syncing: boolean;
    behindCount: number;
    aheadCount: number;
    hasMergeConflict: boolean;
    lastChecked: Date | null;
    lastSynced: Date | null;
    error: string | null;
}

interface SetupStatus {
    checked: boolean;
    gitInstalled: boolean;
    gitInitialized: boolean;
    hasRemote: boolean;
    hasPAT: boolean;
}

interface GHSyncContextValue {
    status: SyncStatus;
    setupStatus: SetupStatus;
    checkForChanges: () => Promise<void>;
    sync: () => Promise<void>;
    recheckSetup: () => Promise<void>;
    clearMergeConflict: () => void;
    isReady: boolean; // true if git is initialized and has remote
    needsSetup: boolean; // true if PAT is missing (when using PAT auth) or git not configured
    gitAuthMode: GitAuthMode;
    setGitAuthMode: (mode: GitAuthMode) => void;
}

const GHSyncContext = createContext<GHSyncContextValue | null>(null);

const CHANGE_DEBOUNCE_MS = 5000; // 5 seconds

export function GHSyncProvider(props: { children: React.ReactNode }) {
    const { children } = props;
    const { gitAuthMode, setGitAuthMode, autoSync } = useWorkspaceContext();
    const { activeWorkspace } = useWorkspaceSwitcher();
    const { getToken } = useTeamAuth();
    const isTeamMode = activeWorkspace?.teamMode === "team";
    // GitHub-backed team workspaces use installation tokens for git sync
    const hasGitHubInstallation = Boolean(activeWorkspace?.installationId);
    // Only skip sync when in team mode WITHOUT a GitHub installation (Y.js only)
    const skipSync = isTeamMode && !hasGitHubInstallation;
    const [isReady, setIsReady] = useState(false);
    const [status, setStatus] = useState<SyncStatus>({
        checking: false,
        syncing: false,
        behindCount: 0,
        aheadCount: 0,
        hasMergeConflict: false,
        lastChecked: null,
        lastSynced: null,
        error: null,
    });
    const [setupStatus, setSetupStatus] = useState<SetupStatus>({
        checked: false,
        gitInstalled: true, // Assume true until we know otherwise
        gitInitialized: false,
        hasRemote: false,
        hasPAT: false,
    });
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const changeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const changeWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const syncRef = useRef<(() => Promise<void>) | null>(null);

    // Cached installation token for GitHub-backed workspaces
    const installationTokenRef = useRef<{ token: string; expiresAt: Date } | null>(null);

    // Fetch a fresh installation access token from team-backend
    const getInstallationToken = useCallback(async (): Promise<string | null> => {
        if (!hasGitHubInstallation || !activeWorkspace?.installationId) return null;

        // Return cached token if still valid (with 5 minute buffer)
        const cached = installationTokenRef.current;
        if (cached && new Date(cached.expiresAt).getTime() > Date.now() + 5 * 60 * 1000) {
            return cached.token;
        }

        try {
            const clerkToken = await getToken();
            if (!clerkToken) return null;

            const res = await fetch(
                `${TEAM_BACKEND_URL}/api/github/installations/${activeWorkspace.installationId}/token`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${clerkToken}` },
                },
            );

            if (!res.ok) return null;

            const data = (await res.json()) as { token: string; expiresAt: string };
            installationTokenRef.current = {
                token: data.token,
                expiresAt: new Date(data.expiresAt),
            };
            return data.token;
        } catch {
            return null;
        }
    }, [hasGitHubInstallation, activeWorkspace?.installationId, getToken]);

    // Helper to create fetch options with optional authToken for GitHub-backed workspaces
    const makeSyncFetchOptions = useCallback(async (method: string): Promise<RequestInit> => {
        if (!hasGitHubInstallation) {
            return { method };
        }

        const authToken = await getInstallationToken();
        if (!authToken) {
            return { method };
        }

        return {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authToken }),
        };
    }, [hasGitHubInstallation, getInstallationToken]);

    // Check if GitHub PAT is set
    const checkPAT = useCallback(async (): Promise<boolean> => {
        try {
            const response = await fetch("/api/secrets/list");
            if (response.ok) {
                const data = await response.json();
                const patSecret = data.secrets?.find((s: { key: string; hasValue: boolean }) => s.key === "GITHUB_PAT");
                return patSecret?.hasValue ?? false;
            }
        } catch {
            // Ignore errors
        }
        return false;
    }, []);

    // Check if git is installed on the system
    const checkGitInstalled = useCallback(async (): Promise<boolean> => {
        try {
            const response = await fetch("/api/git/installed");
            if (response.ok) {
                const data = await response.json();
                return data.installed ?? false;
            }
        } catch {
            // Ignore errors
        }
        return false;
    }, []);

    // Check if git is initialized and has a remote
    const checkGitReady = useCallback(async () => {
        try {
            // First check if git is installed
            const gitInstalled = await checkGitInstalled();
            if (!gitInstalled) {
                setSetupStatus(s => ({
                    ...s,
                    gitInstalled: false,
                    gitInitialized: false,
                    hasRemote: false,
                }));
                setIsReady(false);
                return false;
            }

            const response = await fetch("/api/git/status");
            if (response.ok) {
                const data = await response.json();
                const ready = data.initialized && data.hasRemote;
                setIsReady(ready);
                setSetupStatus(s => ({
                    ...s,
                    gitInstalled: true,
                    gitInitialized: data.initialized,
                    hasRemote: data.hasRemote,
                }));
                if (data.hasMergeConflict) {
                    setStatus(s => ({ ...s, hasMergeConflict: true }));
                }
                return ready;
            }
        } catch {
            // If the API fails, git might not be installed
            setSetupStatus(s => ({
                ...s,
                gitInstalled: false,
                gitInitialized: false,
                hasRemote: false,
            }));
        }
        setIsReady(false);
        return false;
    }, [checkGitInstalled]);

    // Full setup check (git + PAT)
    const recheckSetup = useCallback(async () => {
        const [hasPAT] = await Promise.all([
            checkPAT(),
            checkGitReady(),
        ]);
        setSetupStatus(s => ({
            ...s,
            checked: true,
            hasPAT,
        }));
    }, [checkPAT, checkGitReady]);

    // Check for remote changes
    const checkForChanges = useCallback(async () => {
        if (!isReady) return;

        setStatus(s => ({ ...s, checking: true, error: null }));

        try {
            const fetchOpts = await makeSyncFetchOptions("POST");
            const response = await fetch("/api/git/fetch-status", fetchOpts);
            if (response.ok) {
                const data = await response.json();

                setStatus(s => ({
                    ...s,
                    checking: false,
                    behindCount: data.behindCount,
                    aheadCount: data.aheadCount,
                    lastChecked: new Date(),
                }));

                // Auto-sync if there are incoming changes (but not if there's an active merge conflict)
                if (data.behindCount > 0 && !status.hasMergeConflict) {
                    syncRef.current?.();
                }
            } else {
                const data = await response.json();
                setStatus(s => ({
                    ...s,
                    checking: false,
                    error: data.error || "Failed to check for changes",
                }));
            }
        } catch (error) {
            setStatus(s => ({
                ...s,
                checking: false,
                error: error instanceof Error ? error.message : "Failed to check for changes",
            }));
        }
    }, [isReady, status.hasMergeConflict, makeSyncFetchOptions]);

    // Sync (commit, pull, then push)
    const sync = useCallback(async () => {
        if (!isReady) return;

        // Don't sync if there's an active merge conflict
        if (status.hasMergeConflict) {
            return;
        }

        setStatus(s => ({ ...s, syncing: true, error: null }));

        try {
            // First commit any local changes
            const commitResponse = await fetch("/api/git/commit", { method: "POST" });
            if (!commitResponse.ok) {
                const data = await commitResponse.json();
                throw new Error(data.error || "Commit failed");
            }

            // Then pull (with optional authToken for GitHub-backed workspaces)
            const pullOpts = await makeSyncFetchOptions("POST");
            const pullResponse = await fetch("/api/git/pull", pullOpts);
            const pullData = await pullResponse.json();

            if (!pullResponse.ok) {
                // Check for actual merge conflict (indicated by hadConflicts flag from our pull implementation)
                if (pullData.hadConflicts === true) {
                    setStatus(s => ({ ...s, syncing: false, hasMergeConflict: true, error: "Merge conflict detected. Please resolve conflicts before syncing." }));
                    return;
                }
                throw new Error(pullData.error || "Pull failed");
            }

            // Then push (with optional authToken for GitHub-backed workspaces)
            const pushOpts = await makeSyncFetchOptions("POST");
            const pushResponse = await fetch("/api/git/push", pushOpts);
            if (!pushResponse.ok) {
                const data = await pushResponse.json();
                throw new Error(data.error || "Push failed");
            }

            // Success - reset counts
            setStatus(s => ({
                ...s,
                syncing: false,
                behindCount: 0,
                aheadCount: 0,
                lastChecked: new Date(),
                lastSynced: new Date(),
            }));
        } catch (error) {
            setStatus(s => ({
                ...s,
                syncing: false,
                error: error instanceof Error ? error.message : "Sync failed",
            }));
        }
    }, [isReady, status.hasMergeConflict, makeSyncFetchOptions]);

    // Keep syncRef updated
    useEffect(() => {
        syncRef.current = sync;
    }, [sync]);

    // Initial check on mount — skip when sync is disabled
    useEffect(() => {
        if (skipSync) return;
        recheckSetup().then(() => {
            // checkForChanges will be triggered by isReady changing
        });
    }, [recheckSetup, skipSync]);

    // Start polling when ready — skip when sync is disabled
    // In local mode, we don't need a PAT — system credentials are used
    // In GitHub-backed team mode, installation tokens are handled automatically
    const authReady = hasGitHubInstallation || gitAuthMode === "local" || setupStatus.hasPAT;
    useEffect(() => {
        if (skipSync) return;
        if (isReady && authReady) {
            checkForChanges();
        }
    }, [isReady, authReady, checkForChanges, skipSync]);

    // Scheduled polling for remote changes (configurable interval)
    // Also pauses when there's an active merge conflict or when sync is disabled
    useEffect(() => {
        if (skipSync || !isReady || !autoSync.enabled || autoSync.paused || status.hasMergeConflict) {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            return;
        }

        const pollInterval = autoSync.intervalSeconds * 1000;
        pollIntervalRef.current = setInterval(() => {
            checkForChanges();
        }, pollInterval);

        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [skipSync, isReady, autoSync.enabled, autoSync.paused, autoSync.intervalSeconds, status.hasMergeConflict, checkForChanges]);

    // File watching with debounce (polls git status every 3 seconds, debounces sync by 5 seconds)
    // Also pauses when there's an active merge conflict or when sync is disabled
    useEffect(() => {
        if (skipSync || !isReady || !autoSync.enabled || !autoSync.syncOnChanges || autoSync.paused || status.hasMergeConflict) {
            if (changeDebounceRef.current) {
                clearTimeout(changeDebounceRef.current);
                changeDebounceRef.current = null;
            }
            if (changeWatchRef.current) {
                clearTimeout(changeWatchRef.current);
                changeWatchRef.current = null;
            }
            return;
        }

        let lastChangeDetected: number | null = null;
        let isWatching = true;

        const watchForChanges = async () => {
            if (!isWatching) return;

            try {
                const response = await fetch("/api/git/status");
                if (response.ok) {
                    const data = await response.json();

                    if (data.hasUncommittedChanges) {
                        const now = Date.now();
                        // Only reset timer if it's a new change window
                        if (lastChangeDetected === null || now - lastChangeDetected > CHANGE_DEBOUNCE_MS) {
                            lastChangeDetected = now;

                            // Clear any existing debounce
                            if (changeDebounceRef.current) {
                                clearTimeout(changeDebounceRef.current);
                            }

                            // Sync after 5 seconds of no new changes
                            changeDebounceRef.current = setTimeout(() => {
                                syncRef.current?.();
                            }, CHANGE_DEBOUNCE_MS);
                        }
                    }
                }
            } catch (error) {
                // Ignore errors during status polling
                console.error("Error watching for changes:", error);
            }

            // Schedule next check
            if (isWatching) {
                changeWatchRef.current = setTimeout(watchForChanges, 3000);
            }
        };

        // Start watching
        watchForChanges();

        return () => {
            isWatching = false;
            if (changeDebounceRef.current) {
                clearTimeout(changeDebounceRef.current);
                changeDebounceRef.current = null;
            }
            if (changeWatchRef.current) {
                clearTimeout(changeWatchRef.current);
                changeWatchRef.current = null;
            }
        };
    }, [skipSync, isReady, autoSync.enabled, autoSync.syncOnChanges, autoSync.paused, status.hasMergeConflict]);

    // Re-check ready state when navigating (in case user sets up git)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                checkGitReady();
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [checkGitReady]);

    // Computed: needs setup if git not installed, git not configured with remote,
    // or PAT missing when using PAT auth mode
    const needsSetup = setupStatus.checked && (
        !setupStatus.gitInstalled ||
        !setupStatus.hasRemote ||
        (gitAuthMode === "pat" && !setupStatus.hasPAT)
    );

    return (
        <GHSyncContext.Provider value={{
            status,
            setupStatus,
            checkForChanges,
            sync,
            recheckSetup,
            clearMergeConflict: () => setStatus(s => ({ ...s, hasMergeConflict: false, error: null })),
            isReady,
            needsSetup,
            gitAuthMode,
            setGitAuthMode,
        }}>
            {children}
        </GHSyncContext.Provider>
    );
}

export function useGHSync() {
    const context = useContext(GHSyncContext);
    if (!context) {
        throw new Error("useGHSync must be used within a GHSyncProvider");
    }
    return context;
}
