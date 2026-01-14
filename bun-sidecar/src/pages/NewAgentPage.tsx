import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { KeyboardShortcutsProvider } from "@/contexts/KeyboardShortcutsContext";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useTheme } from "@/hooks/useTheme";
import { useAgentsAPI } from "@/hooks/useAgentsAPI";
import type { AgentConfig, McpServerDefinition } from "@/features/agents/index";
import { MODEL_DISPLAY_NAMES } from "@/features/agents/index";
import { ArrowLeft } from "lucide-react";

type AgentModel = AgentConfig["model"];

function NewAgentContent() {
    const { currentTheme } = useTheme();
    const api = useAgentsAPI();
    const navigate = useNavigate();

    const [mcpRegistry, setMcpRegistry] = useState<McpServerDefinition[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formSystemPrompt, setFormSystemPrompt] = useState("");
    const [formModel, setFormModel] = useState<AgentModel>("claude-sonnet-4-5-20250929");
    const [formMcpServers, setFormMcpServers] = useState<string[]>([]);

    // Load MCP registry on mount
    useEffect(() => {
        loadMcpRegistry();
    }, []);

    async function loadMcpRegistry() {
        setIsLoading(true);
        try {
            const registry = await api.getMcpRegistry();
            setMcpRegistry(registry);
        } catch (error) {
            console.error("Failed to load MCP registry:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSave() {
        setIsSaving(true);
        try {
            await api.createAgent({
                name: formName,
                description: formDescription || undefined,
                systemPrompt: formSystemPrompt,
                model: formModel,
                mcpServers: formMcpServers,
            });
            navigate("/agents");
        } catch (error) {
            console.error("Failed to save agent:", error);
        } finally {
            setIsSaving(false);
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
                <p style={{ color: currentTheme.styles.contentSecondary }}>Loading...</p>
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
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("/agents")}
                    title="Back to Agents"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                        Create New Agent
                    </h1>
                    <p style={{ color: currentTheme.styles.contentSecondary }}>
                        Configure the agent's settings, system prompt, and MCP servers.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Agent Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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

                    <div className="space-y-2">
                        <Label>MCP Servers</Label>
                        {mcpRegistry.length === 0 ? (
                            <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                No MCP servers available.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {mcpRegistry.map((server) => (
                                    <div key={server.id} className="flex items-start space-x-3">
                                        <Checkbox
                                            id={`mcp-${server.id}`}
                                            checked={formMcpServers.includes(server.id)}
                                            onCheckedChange={() => toggleMcpServer(server.id)}
                                        />
                                        <div className="grid gap-1.5 leading-none">
                                            <label
                                                htmlFor={`mcp-${server.id}`}
                                                className="text-sm font-medium cursor-pointer"
                                            >
                                                {server.name}
                                            </label>
                                            <p className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                                                {server.description}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => navigate("/agents")}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={!formName.trim() || isSaving}>
                            {isSaving ? "Creating..." : "Create Agent"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export function NewAgentPage() {
    return (
        <WorkspaceProvider>
            <KeyboardShortcutsProvider>
                <SidebarProvider>
                    <div className="flex h-screen w-full overflow-hidden">
                        <WorkspaceSidebar />
                        <SidebarInset className="flex-1 overflow-hidden">
                            <NewAgentContent />
                        </SidebarInset>
                    </div>
                </SidebarProvider>
            </KeyboardShortcutsProvider>
        </WorkspaceProvider>
    );
}
