import { useState, useEffect, useCallback, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/hooks/useTheme";
import { useTeamAuth } from "@/contexts/AuthContext";
import { Github, Loader2, Search, ExternalLink, Check } from "lucide-react";
import { getTeamBackendHttpUrl } from "@/lib/team-backend-config";

interface Installation {
    id: string;
    installationId: number;
    accountLogin: string;
    accountType: string;
    accountAvatarUrl: string | null;
}

interface GitHubRepo {
    id: number;
    fullName: string;
    name: string;
    isPrivate: boolean;
    defaultBranch: string;
    htmlUrl: string;
}

interface Org {
    id: string;
    name: string;
}

type Step = "installations" | "repos" | "confirm";

interface GitHubRepoPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function GitHubRepoPickerDialog(props: GitHubRepoPickerDialogProps) {
    const { open, onOpenChange } = props;
    const { currentTheme } = useTheme();
    const { getToken } = useTeamAuth();

    const [step, setStep] = useState<Step>("installations");
    const [installations, setInstallations] = useState<Installation[]>([]);
    const [selectedInstallation, setSelectedInstallation] = useState<Installation | null>(null);
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
    const [orgs, setOrgs] = useState<Org[]>([]);
    const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [repoSearch, setRepoSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchWithAuth = useCallback(async (path: string, options?: RequestInit) => {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");
        const teamBackendUrl = await getTeamBackendHttpUrl();
        return fetch(`${teamBackendUrl}${path}`, {
            ...options,
            headers: {
                ...options?.headers,
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
    }, [getToken]);

    // Fetch installations
    const fetchInstallations = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth("/api/github/installations");
            if (!res.ok) throw new Error("Failed to fetch installations");
            const data = (await res.json()) as Installation[];
            setInstallations(data);

            if (data.length > 0) {
                // If there's only one installation, auto-select it
                if (data.length === 1) {
                    setSelectedInstallation(data[0]);
                    setStep("repos");
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load installations");
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth]);

    // Fetch repos for selected installation
    const fetchRepos = useCallback(async (installId: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(
                `/api/github/installations/${installId}/repos`,
            );
            if (!res.ok) throw new Error("Failed to fetch repos");
            const data = (await res.json()) as GitHubRepo[];
            setRepos(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load repos");
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth]);

    // Fetch orgs, auto-creating a default one if none exist
    const fetchOrgs = useCallback(async () => {
        try {
            const res = await fetchWithAuth("/api/orgs");
            if (!res.ok) throw new Error("Failed to fetch orgs");
            let data = (await res.json()) as Org[];

            // Auto-create a default org if the user has none
            if (data.length === 0) {
                const createRes = await fetchWithAuth("/api/orgs", {
                    method: "POST",
                    body: JSON.stringify({ name: "My Team" }),
                });
                if (createRes.ok) {
                    const newOrg = (await createRes.json()) as Org;
                    data = [newOrg];
                }
            }

            setOrgs(data);
            if (data.length > 0) {
                setSelectedOrg(data[0]);
            }
        } catch {
            // Non-critical: we'll ask user to create org
        }
    }, [fetchWithAuth]);

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setStep("installations");
            setInstallations([]);
            setSelectedInstallation(null);
            setRepos([]);
            setSelectedRepo(null);
            setDisplayName("");
            setRepoSearch("");
            setError(null);
            fetchInstallations();
            fetchOrgs();
        } else {
            // Clean up polling
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        }
    }, [open, fetchInstallations, fetchOrgs]);

    // When installation is selected, fetch repos
    useEffect(() => {
        if (selectedInstallation && step === "repos") {
            fetchRepos(selectedInstallation.id);
        }
    }, [selectedInstallation, step, fetchRepos]);

    // Poll for installations (when user is connecting GitHub)
    const startPolling = useCallback(() => {
        if (pollRef.current) return;
        pollRef.current = setInterval(async () => {
            try {
                const token = await getToken();
                if (!token) return;
                const teamBackendUrl = await getTeamBackendHttpUrl();
                const res = await fetch(`${teamBackendUrl}/api/github/installations`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = (await res.json()) as Installation[];
                    if (data.length > 0) {
                        setInstallations(data);
                        if (pollRef.current) {
                            clearInterval(pollRef.current);
                            pollRef.current = null;
                        }
                    }
                }
            } catch {
                // Ignore polling errors
            }
        }, 2000);
    }, [getToken]);

    const handleConnectGitHub = async () => {
        // Get state token from team-backend
        try {
            const res = await fetchWithAuth("/api/github/state-token", {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to generate state token");
            const { stateToken } = (await res.json()) as { stateToken: string };

            // Open GitHub App installation page
            // The app name should be configured — for now use a well-known URL pattern
            const appName = "nomendex-team";
            window.open(
                `https://github.com/apps/${appName}/installations/new?state=${stateToken}`,
                "_blank",
            );

            // Start polling for the installation to appear
            startPolling();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to connect GitHub");
        }
    };

    const handleSelectInstallation = (inst: Installation) => {
        setSelectedInstallation(inst);
        setStep("repos");
    };

    const handleSelectRepo = (repo: GitHubRepo) => {
        setSelectedRepo(repo);
        setDisplayName(repo.name);
        setStep("confirm");
    };

    const handleCreate = async () => {
        if (!selectedRepo || !selectedInstallation || !selectedOrg) return;

        setCreating(true);
        setError(null);

        try {
            // 1. Create OrgWorkspace in team-backend (or use existing if repo already linked)
            let orgWorkspaceId: string;

            const wsRes = await fetchWithAuth(
                `/api/orgs/${selectedOrg.id}/workspaces`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        installationId: selectedInstallation.id,
                        repoFullName: selectedRepo.fullName,
                        repoId: selectedRepo.id,
                        defaultBranch: selectedRepo.defaultBranch,
                        displayName: displayName || selectedRepo.name,
                    }),
                },
            );

            if (wsRes.status === 409) {
                // Repo already linked — find the existing org workspace
                const listRes = await fetchWithAuth(
                    `/api/orgs/${selectedOrg.id}/workspaces`,
                );
                if (!listRes.ok) throw new Error("Failed to fetch org workspaces");
                const existing = (await listRes.json()) as Array<{ id: string; repoFullName: string }>;
                const match = existing.find((ws) => ws.repoFullName === selectedRepo.fullName);
                if (!match) throw new Error("Could not find existing workspace for this repo");
                orgWorkspaceId = match.id;
            } else if (!wsRes.ok) {
                const errData = (await wsRes.json()) as { error?: string };
                throw new Error(errData.error || "Failed to create org workspace");
            } else {
                const orgWorkspace = (await wsRes.json()) as { id: string };
                orgWorkspaceId = orgWorkspace.id;
            }

            // 2. Get installation token for git operations
            const tokenRes = await fetchWithAuth(
                `/api/github/installations/${selectedInstallation.id}/token`,
                { method: "POST" },
            );

            if (!tokenRes.ok) throw new Error("Failed to get installation token");
            const { token: authToken } = (await tokenRes.json()) as { token: string };

            // 3. Clone the repo locally via bun-sidecar
            const cloneRes = await fetch("/api/workspaces/create-from-github", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    repoFullName: selectedRepo.fullName,
                    displayName: displayName || selectedRepo.name,
                    orgId: selectedOrg.id,
                    orgWorkspaceId,
                    installationId: selectedInstallation.id,
                    githubInstallationId: selectedInstallation.installationId,
                    defaultBranch: selectedRepo.defaultBranch,
                    authToken,
                }),
            });

            const cloneData = (await cloneRes.json()) as { success: boolean; message?: string };

            if (!cloneData.success) {
                throw new Error(cloneData.message || "Failed to clone repo");
            }

            // Success — reload to switch to the new workspace
            onOpenChange(false);
            window.location.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create workspace");
        } finally {
            setCreating(false);
        }
    };

    const filteredRepos = repos.filter((r) =>
        r.fullName.toLowerCase().includes(repoSearch.toLowerCase()),
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-md"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                    color: currentTheme.styles.contentPrimary,
                }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Github className="size-5" />
                        Create from GitHub
                    </DialogTitle>
                    <DialogDescription style={{ color: currentTheme.styles.contentSecondary }}>
                        {step === "installations" && "Select a GitHub account"}
                        {step === "repos" && "Choose a repository"}
                        {step === "confirm" && "Confirm workspace details"}
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div
                        className="text-sm p-3 rounded-md border"
                        style={{
                            color: currentTheme.styles.semanticDestructive,
                            borderColor: currentTheme.styles.semanticDestructive,
                            backgroundColor: `${currentTheme.styles.semanticDestructive}10`,
                        }}
                    >
                        {error}
                    </div>
                )}

                {/* Step 1: Installations */}
                {step === "installations" && (
                    <div className="space-y-3">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="size-6 animate-spin" style={{ color: currentTheme.styles.contentSecondary }} />
                            </div>
                        ) : installations.length === 0 ? (
                            <div className="space-y-4 py-4">
                                <p className="text-sm text-center" style={{ color: currentTheme.styles.contentSecondary }}>
                                    No GitHub App installation found. Connect your GitHub account first.
                                </p>
                                <div className="flex justify-center">
                                    <Button onClick={handleConnectGitHub}>
                                        <Github className="size-4 mr-2" />
                                        Connect GitHub
                                    </Button>
                                </div>
                                {pollRef.current && (
                                    <p className="text-xs text-center" style={{ color: currentTheme.styles.contentTertiary }}>
                                        Waiting for connection...
                                    </p>
                                )}
                            </div>
                        ) : (
                            installations.map((inst) => (
                                <button
                                    key={inst.id}
                                    onClick={() => handleSelectInstallation(inst)}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                                    style={{
                                        borderColor: currentTheme.styles.borderDefault,
                                        backgroundColor: currentTheme.styles.surfaceSecondary,
                                    }}
                                >
                                    {inst.accountAvatarUrl && (
                                        <img
                                            src={inst.accountAvatarUrl}
                                            alt={inst.accountLogin}
                                            className="size-8 rounded-full"
                                        />
                                    )}
                                    <div className="flex-1 text-left">
                                        <p className="font-medium text-sm">{inst.accountLogin}</p>
                                        <p className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                                            {inst.accountType}
                                        </p>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                )}

                {/* Step 2: Repos */}
                {step === "repos" && (
                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: currentTheme.styles.contentTertiary }} />
                            <Input
                                placeholder="Search repositories..."
                                value={repoSearch}
                                onChange={(e) => setRepoSearch(e.target.value)}
                                className="pl-9"
                                autoFocus
                            />
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="size-6 animate-spin" style={{ color: currentTheme.styles.contentSecondary }} />
                            </div>
                        ) : (
                            <div className="max-h-64 overflow-y-auto space-y-1">
                                {filteredRepos.map((repo) => (
                                    <button
                                        key={repo.id}
                                        onClick={() => handleSelectRepo(repo)}
                                        className="w-full flex items-center gap-3 p-2 rounded-md transition-colors text-left focus:outline-none focus:ring-2 focus:ring-offset-1"
                                        style={{
                                            color: currentTheme.styles.contentPrimary,
                                        }}
                                    >
                                        <Github className="size-4 shrink-0" style={{ color: currentTheme.styles.contentSecondary }} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{repo.fullName}</p>
                                            <p className="text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                                {repo.isPrivate ? "Private" : "Public"} · {repo.defaultBranch}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                                {filteredRepos.length === 0 && !loading && (
                                    <p className="text-sm text-center py-4" style={{ color: currentTheme.styles.contentSecondary }}>
                                        No repositories found
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex justify-between pt-2">
                            <Button variant="ghost" size="sm" onClick={() => setStep("installations")}>
                                Back
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                                <a
                                    href={`https://github.com/settings/installations`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <ExternalLink className="size-3 mr-1" />
                                    Manage access
                                </a>
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 3: Confirm */}
                {step === "confirm" && selectedRepo && (
                    <div className="space-y-4">
                        <div
                            className="p-3 rounded-lg border"
                            style={{
                                borderColor: currentTheme.styles.borderDefault,
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <Github className="size-4" style={{ color: currentTheme.styles.contentSecondary }} />
                                <span className="text-sm font-medium">{selectedRepo.fullName}</span>
                            </div>
                            <p className="text-xs mt-1" style={{ color: currentTheme.styles.contentTertiary }}>
                                Branch: {selectedRepo.defaultBranch} · {selectedRepo.isPrivate ? "Private" : "Public"}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="display-name" className="text-sm">
                                Display Name
                            </Label>
                            <Input
                                id="display-name"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder={selectedRepo.name}
                                autoFocus
                            />
                        </div>

                        {orgs.length > 1 && (
                            <div className="space-y-2">
                                <Label className="text-sm">Organization</Label>
                                <div className="space-y-1">
                                    {orgs.map((org) => (
                                        <button
                                            key={org.id}
                                            onClick={() => setSelectedOrg(org)}
                                            className="w-full flex items-center gap-2 p-2 rounded-md text-left text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
                                            style={{
                                                backgroundColor: selectedOrg?.id === org.id
                                                    ? currentTheme.styles.surfaceAccent
                                                    : "transparent",
                                            }}
                                        >
                                            <Check
                                                className="size-3"
                                                style={{
                                                    opacity: selectedOrg?.id === org.id ? 1 : 0,
                                                }}
                                            />
                                            {org.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between pt-2">
                            <Button variant="ghost" onClick={() => setStep("repos")}>
                                Back
                            </Button>
                            <Button
                                onClick={handleCreate}
                                disabled={creating || !selectedOrg || !displayName.trim()}
                            >
                                {creating ? (
                                    <Loader2 className="size-4 mr-2 animate-spin" />
                                ) : (
                                    <Github className="size-4 mr-2" />
                                )}
                                {creating ? "Cloning..." : "Create Workspace"}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
