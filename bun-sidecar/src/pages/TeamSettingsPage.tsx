import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useTheme } from "@/hooks/useTheme";
import { useTeamAuth } from "@/contexts/AuthContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { Users, LogIn, LogOut, Shield, Crown, Eye, Pencil, Loader2, Github, ExternalLink } from "lucide-react";

interface VaultInfo {
    id: string;
    name: string;
    clerkOrgId: string;
    ownerClerkUserId: string;
    githubOwner: string | null;
    githubRepo: string | null;
    githubBranch: string;
    createdAt: string;
    updatedAt: string;
}

interface VaultMemberInfo {
    vaultId: string;
    clerkUserId: string;
    role: "owner" | "editor" | "viewer";
    joinedAt: string;
}

function getRoleIcon(role: string) {
    switch (role) {
        case "owner":
            return Crown;
        case "editor":
            return Pencil;
        case "viewer":
            return Eye;
        default:
            return Shield;
    }
}

function SoloModeContent() {
    const { currentTheme } = useTheme();
    const { setAppMode } = useWorkspaceSwitcher();
    const [enabling, setEnabling] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleEnableTeamMode = async () => {
        setEnabling(true);
        setError(null);

        try {
            await setAppMode("team");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to enable team mode");
        } finally {
            setEnabling(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Collaboration
                </CardTitle>
                <CardDescription>
                    Enable real-time collaboration on this workspace
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div
                    className="p-4 rounded-lg border"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <h4 className="font-medium mb-2" style={{ color: currentTheme.styles.contentPrimary }}>
                        This workspace is in solo mode
                    </h4>
                    <p className="text-sm mb-4" style={{ color: currentTheme.styles.contentSecondary }}>
                        Solo mode means all your data stays local on your machine. Enable team mode to
                        collaborate with others in real-time using conflict-free sync.
                    </p>
                    <div className="space-y-2 text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                        <p>Team mode provides:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>Real-time collaborative editing of notes and todos</li>
                            <li>Automatic conflict-free merging (CRDT-based)</li>
                            <li>Offline support with automatic sync on reconnect</li>
                            <li>Optional GitHub backup of all vault content</li>
                            <li>Role-based access control (owner, editor, viewer)</li>
                        </ul>
                    </div>
                </div>

                <div className="pt-2">
                    <Button onClick={handleEnableTeamMode} disabled={enabling}>
                        {enabling ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <LogIn className="mr-2 h-4 w-4" />
                        )}
                        {enabling ? "Enabling..." : "Enable Team Mode"}
                    </Button>
                    {error && (
                        <p className="text-xs mt-2" style={{ color: currentTheme.styles.semanticDestructive }}>
                            {error}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function TeamModeContent() {
    const { currentTheme } = useTheme();
    const { isSignedIn, userName, userImageUrl, signOut } = useTeamAuth();
    const { activeWorkspace, setAppMode } = useWorkspaceSwitcher();
    const [vault, setVault] = useState<VaultInfo | null>(null);
    const [members, _setMembers] = useState<VaultMemberInfo[]>([]);
    const [_currentUserRole, _setCurrentUserRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [disabling, setDisabling] = useState(false);

    const handleDisableTeamMode = async () => {
        setDisabling(true);
        setError(null);

        try {
            await setAppMode("solo");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to disable team mode");
        } finally {
            setDisabling(false);
        }
    };

    const vaultId = activeWorkspace?.teamVaultId;

    const fetchVaultDetails = useCallback(async () => {
        if (!vaultId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // In a full implementation, this would call the Cloudflare Worker directly
            // For now, show the vault ID and a placeholder
            setVault({
                id: vaultId,
                name: activeWorkspace?.name ?? "Team Vault",
                clerkOrgId: "",
                ownerClerkUserId: "",
                githubOwner: null,
                githubRepo: null,
                githubBranch: "main",
                createdAt: "",
                updatedAt: "",
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load vault details");
        } finally {
            setLoading(false);
        }
    }, [vaultId, activeWorkspace?.name]);

    useEffect(() => {
        fetchVaultDetails();
    }, [fetchVaultDetails]);

    if (loading) {
        return (
            <Card>
                <CardContent className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin" style={{ color: currentTheme.styles.contentSecondary }} />
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Auth Status */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Account
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {userImageUrl && (
                                <img
                                    src={userImageUrl}
                                    alt="Profile"
                                    className="h-10 w-10 rounded-full"
                                />
                            )}
                            <div>
                                <p className="font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                                    {userName ?? "Signed In"}
                                </p>
                                <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                    {isSignedIn ? "Authenticated" : "Not signed in"}
                                </p>
                            </div>
                        </div>
                        {isSignedIn && (
                            <Button variant="outline" size="sm" onClick={() => signOut()}>
                                <LogOut className="mr-2 h-4 w-4" />
                                Sign Out
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Vault Details */}
            {vault && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Vault: {vault.name}
                        </CardTitle>
                        <CardDescription>
                            Vault ID: {vault.id}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Connection Status */}
                        <div
                            className="p-4 rounded-lg border"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                borderColor: currentTheme.styles.borderDefault,
                            }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                                        Sync Status
                                    </h4>
                                    <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                        Connection to collaboration server
                                    </p>
                                </div>
                                <Badge variant="secondary">Disconnected</Badge>
                            </div>
                        </div>

                        {/* GitHub Connection */}
                        <div
                            className="p-4 rounded-lg border"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                borderColor: currentTheme.styles.borderDefault,
                            }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="font-medium flex items-center gap-2" style={{ color: currentTheme.styles.contentPrimary }}>
                                        <Github className="h-4 w-4" />
                                        GitHub Repository
                                    </h4>
                                    {activeWorkspace?.repoFullName ? (
                                        <div className="mt-1">
                                            <a
                                                href={`https://github.com/${activeWorkspace.repoFullName}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm flex items-center gap-1 hover:underline"
                                                style={{ color: currentTheme.styles.contentSecondary }}
                                            >
                                                {activeWorkspace.repoFullName}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                            <p className="text-xs mt-0.5" style={{ color: currentTheme.styles.contentTertiary }}>
                                                Branch: {activeWorkspace.defaultBranch || "main"}
                                            </p>
                                        </div>
                                    ) : vault.githubOwner && vault.githubRepo ? (
                                        <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                            {vault.githubOwner}/{vault.githubRepo} ({vault.githubBranch})
                                        </p>
                                    ) : (
                                        <p className="text-sm" style={{ color: currentTheme.styles.contentTertiary }}>
                                            Not connected
                                        </p>
                                    )}
                                </div>
                                {!activeWorkspace?.repoFullName && (
                                    <Button variant="outline" size="sm" disabled>
                                        Connect Repo
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Members */}
                        {members.length > 0 && (
                            <div>
                                <h4 className="font-medium mb-3" style={{ color: currentTheme.styles.contentPrimary }}>
                                    Members
                                </h4>
                                <div className="space-y-2">
                                    {members.map((member) => {
                                        const RoleIcon = getRoleIcon(member.role);
                                        return (
                                            <div
                                                key={member.clerkUserId}
                                                className="flex items-center justify-between p-3 rounded-lg border"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                                    borderColor: currentTheme.styles.borderDefault,
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <RoleIcon className="h-4 w-4" style={{ color: currentTheme.styles.contentSecondary }} />
                                                    <span style={{ color: currentTheme.styles.contentPrimary }}>
                                                        {member.clerkUserId}
                                                    </span>
                                                </div>
                                                <Badge variant="secondary">{member.role}</Badge>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Disable Team Mode */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDisableTeamMode}
                        disabled={disabling}
                    >
                        {disabling ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <LogOut className="mr-2 h-4 w-4" />
                        )}
                        {disabling ? "Disabling..." : "Disable Team Mode"}
                    </Button>
                    <p className="text-xs mt-2" style={{ color: currentTheme.styles.contentTertiary }}>
                        Reverts this workspace to solo mode. Your local files are not affected.
                    </p>
                </CardContent>
            </Card>

            {error && (
                <Card>
                    <CardContent className="py-4">
                        <p className="text-sm" style={{ color: currentTheme.styles.semanticDestructive }}>
                            {error}
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function TeamSettingsContent() {
    const { currentTheme } = useTheme();
    const { appMode } = useWorkspaceSwitcher();
    const isTeamMode = appMode === "team";

    return (
        <div
            className="h-full overflow-y-auto p-6 space-y-6"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            <div>
                <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                    Team
                </h1>
                <p style={{ color: currentTheme.styles.contentSecondary }}>
                    Manage team collaboration for this workspace.
                </p>
            </div>

            <Separator />

            {isTeamMode ? <TeamModeContent /> : <SoloModeContent />}
        </div>
    );
}

export function TeamSettingsPage() {
    return (
        <SidebarProvider>
            <div className="flex h-screen w-full overflow-hidden">
                <WorkspaceSidebar />
                <SidebarInset className="flex-1 overflow-hidden">
                    <TeamSettingsContent />
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
