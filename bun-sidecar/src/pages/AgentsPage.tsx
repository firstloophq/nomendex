import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { KeyboardShortcutsProvider } from "@/contexts/KeyboardShortcutsContext";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useTheme } from "@/hooks/useTheme";
import { useAgentsAPI } from "@/hooks/useAgentsAPI";
import { useMcpServersAPI } from "@/hooks/useMcpServersAPI";
import type { AgentConfig } from "@/features/agents/index";
import { MODEL_DISPLAY_NAMES } from "@/features/agents/index";
import type { UserMcpServer } from "@/features/mcp-servers/mcp-server-types";
import { Plus, Pencil, Trash2, Copy, Bot, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

type AgentModel = AgentConfig["model"];

function AgentsContent() {
    const { currentTheme } = useTheme();
    const navigate = useNavigate();
    const api = useAgentsAPI();
    const mcpServersAPI = useMcpServersAPI();

    const [agents, setAgents] = useState<AgentConfig[]>([]);
    const [allMcpServers, setAllMcpServers] = useState<CombinedMcpServer[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Dialog state (for edit and delete only)
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
    const [deleteConfirmAgent, setDeleteConfirmAgent] = useState<AgentConfig | null>(null);

    // Form state (for editing)
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formSystemPrompt, setFormSystemPrompt] = useState("");
    const [formModel, setFormModel] = useState<AgentModel>("claude-sonnet-4-5-20250929");
    const [formMcpServers, setFormMcpServers] = useState<string[]>([]);

    // Separate built-in and user-defined servers
    const builtInServers = allMcpServers.filter((s) => s.isBuiltIn);
    const userServers = allMcpServers.filter((s) => !s.isBuiltIn);

    // Load agents and MCP servers on mount
    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const [agentsList, mcpResponse] = await Promise.all([
                api.listAgents(),
                mcpServersAPI.getAllServers(),
            ]);
            setAgents(agentsList);
            setAllMcpServers(mcpResponse.servers);
        } catch (error) {
            console.error("Failed to load agents:", error);
        } finally {
            setIsLoading(false);
        }
    }

    function openCreatePage() {
        navigate("/new-agent");
    }

    function openEditDialog(agent: AgentConfig) {
        setEditingAgent(agent);
        setFormName(agent.name);
        setFormDescription(agent.description || "");
        setFormSystemPrompt(agent.systemPrompt);
        setFormModel(agent.model);
        setFormMcpServers([...agent.mcpServers]);
        setIsDialogOpen(true);
    }

    async function handleSave() {
        try {
            await api.updateAgent({
                agentId: editingAgent!.id,
                updates: {
                    name: formName,
                    description: formDescription || undefined,
                    systemPrompt: formSystemPrompt,
                    model: formModel,
                    mcpServers: formMcpServers,
                },
            });
            setIsDialogOpen(false);
            await loadData();
        } catch (error) {
            console.error("Failed to save agent:", error);
        }
    }

    async function handleDelete(agent: AgentConfig) {
        try {
            await api.deleteAgent({ agentId: agent.id });
            setDeleteConfirmAgent(null);
            await loadData();
        } catch (error) {
            console.error("Failed to delete agent:", error);
        }
    }

    async function handleDuplicate(agent: AgentConfig) {
        try {
            await api.duplicateAgent({ agentId: agent.id });
            await loadData();
        } catch (error) {
            console.error("Failed to duplicate agent:", error);
        }
    }

    function toggleMcpServer(serverId: string) {
        setFormMcpServers((prev) =>
            prev.includes(serverId)
                ? prev.filter((id) => id !== serverId)
                : [...prev, serverId]
        );
    }

    if (isLoading) {
        return (
            <div
                className="flex h-full items-center justify-center"
                style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
            >
                <p style={{ color: currentTheme.styles.contentSecondary }}>Loading agents...</p>
            </div>
        );
    }

    return (
        <div
            className="h-full overflow-y-auto p-6 space-y-6"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                        Agents
                    </h1>
                    <p style={{ color: currentTheme.styles.contentSecondary }}>
                        Configure AI agents with custom system prompts and MCP servers.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => navigate("/mcp-servers")}>
                        <Server className="mr-2 h-4 w-4" />
                        MCP Servers
                    </Button>
                    <Button onClick={openCreatePage}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Agent
                    </Button>
                </div>
            </div>

            <Separator />

            <div className="grid gap-4">
                {agents.map((agent) => (
                    <Card key={agent.id}>
                        <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div
                                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                                    >
                                        <Bot className="h-5 w-5" style={{ color: currentTheme.styles.contentSecondary }} />
                                    </div>
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            {agent.name}
                                            {agent.isDefault && (
                                                <span
                                                    className="text-xs px-2 py-0.5 rounded-full"
                                                    style={{
                                                        backgroundColor: currentTheme.styles.surfaceAccent,
                                                        color: currentTheme.styles.contentAccent,
                                                    }}
                                                >
                                                    Default
                                                </span>
                                            )}
                                        </CardTitle>
                                        <CardDescription>{agent.description || "No description"}</CardDescription>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDuplicate(agent)}
                                        title="Duplicate"
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                    {!agent.isDefault && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openEditDialog(agent)}
                                                title="Edit"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setDeleteConfirmAgent(agent)}
                                                title="Delete"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-4 text-sm">
                                <div>
                                    <span style={{ color: currentTheme.styles.contentSecondary }}>Model: </span>
                                    <span style={{ color: currentTheme.styles.contentPrimary }}>
                                        {MODEL_DISPLAY_NAMES[agent.model]}
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: currentTheme.styles.contentSecondary }}>MCP Servers: </span>
                                    <span style={{ color: currentTheme.styles.contentPrimary }}>
                                        {agent.mcpServers.length === 0
                                            ? "None"
                                            : agent.mcpServers
                                                  .map((id) => allMcpServers.find((s) => s.id === id)?.name || id)
                                                  .join(", ")}
                                    </span>
                                </div>
                                {agent.systemPrompt && (
                                    <div className="w-full">
                                        <span style={{ color: currentTheme.styles.contentSecondary }}>System Prompt: </span>
                                        <span
                                            className="text-xs font-mono"
                                            style={{ color: currentTheme.styles.contentTertiary }}
                                        >
                                            {agent.systemPrompt.length > 100
                                                ? agent.systemPrompt.slice(0, 100) + "..."
                                                : agent.systemPrompt || "(uses default)"}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Agent</DialogTitle>
                        <DialogDescription>
                            Configure the agent's settings, system prompt, and MCP servers.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Name</Label>
                            <Input
                                id="name"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g., Linear Assistant"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description (optional)</Label>
                            <Input
                                id="description"
                                value={formDescription}
                                onChange={(e) => setFormDescription(e.target.value)}
                                placeholder="e.g., An agent specialized for Linear project management"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="model">Model</Label>
                            <Select value={formModel} onValueChange={(value) => setFormModel(value as AgentModel)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(MODEL_DISPLAY_NAMES).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                            {label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="systemPrompt">System Prompt</Label>
                            <Textarea
                                id="systemPrompt"
                                value={formSystemPrompt}
                                onChange={(e) => setFormSystemPrompt(e.target.value)}
                                placeholder="Leave empty to use the default Claude Code system prompt"
                                className="min-h-[120px] font-mono text-sm"
                            />
                            <p className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                                An empty prompt will use Claude Code's default system prompt.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <Label>MCP Servers</Label>
                            {allMcpServers.length === 0 ? (
                                <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                    No MCP servers available.
                                </p>
                            ) : (
                                <div className="space-y-4">
                                    {/* User-defined servers */}
                                    {userServers.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-xs font-medium" style={{ color: currentTheme.styles.contentSecondary }}>
                                                User Defined
                                            </p>
                                            <div className="space-y-2">
                                                {userServers.map((server) => (
                                                    <div key={server.id} className="flex items-start space-x-3">
                                                        <Checkbox
                                                            id={`mcp-edit-${server.id}`}
                                                            checked={formMcpServers.includes(server.id)}
                                                            onCheckedChange={() => toggleMcpServer(server.id)}
                                                        />
                                                        <div className="grid gap-1.5 leading-none">
                                                            <label
                                                                htmlFor={`mcp-edit-${server.id}`}
                                                                className="text-sm font-medium cursor-pointer"
                                                            >
                                                                {server.name}
                                                            </label>
                                                            <p className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                                                                {server.description || "No description"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Built-in servers */}
                                    {builtInServers.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-xs font-medium" style={{ color: currentTheme.styles.contentSecondary }}>
                                                Built-in
                                            </p>
                                            <div className="space-y-2">
                                                {builtInServers.map((server) => (
                                                    <div key={server.id} className="flex items-start space-x-3">
                                                        <Checkbox
                                                            id={`mcp-edit-${server.id}`}
                                                            checked={formMcpServers.includes(server.id)}
                                                            onCheckedChange={() => toggleMcpServer(server.id)}
                                                        />
                                                        <div className="grid gap-1.5 leading-none">
                                                            <label
                                                                htmlFor={`mcp-edit-${server.id}`}
                                                                className="text-sm font-medium cursor-pointer flex items-center gap-2"
                                                            >
                                                                {server.name}
                                                                <Badge variant="secondary" className="text-[10px] px-1 py-0">Built-in</Badge>
                                                            </label>
                                                            <p className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                                                                {server.description || "No description"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={!formName.trim()}>
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteConfirmAgent} onOpenChange={() => setDeleteConfirmAgent(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Agent</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete "{deleteConfirmAgent?.name}"? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirmAgent(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteConfirmAgent && handleDelete(deleteConfirmAgent)}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function AgentsPage() {
    return (
        <WorkspaceProvider>
            <KeyboardShortcutsProvider>
                <SidebarProvider>
                    <div className="flex h-screen w-full overflow-hidden">
                        <WorkspaceSidebar />
                        <SidebarInset className="flex-1 overflow-hidden">
                            <AgentsContent />
                        </SidebarInset>
                    </div>
                </SidebarProvider>
            </KeyboardShortcutsProvider>
        </WorkspaceProvider>
    );
}
