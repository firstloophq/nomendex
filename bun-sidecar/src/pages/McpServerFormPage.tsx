import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Alert,
    AlertDescription,
} from "@/components/ui/alert";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useTheme } from "@/hooks/useTheme";
import { useMcpServersAPI } from "@/hooks/useMcpServersAPI";
import type { TransportConfig, SseTransport, HttpTransport } from "@/features/mcp-servers/mcp-server-types";
import { ArrowLeft, Plus, X, Info } from "lucide-react";

type TransportType = "stdio" | "sse" | "http";

interface KeyValuePair {
    id: string;
    key: string;
    value: string;
}

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function McpServerFormContent() {
    const { currentTheme } = useTheme();
    const navigate = useNavigate();
    const { serverId } = useParams<{ serverId: string }>();
    const api = useMcpServersAPI();

    const isEditing = !!serverId;
    const [isLoading, setIsLoading] = useState(isEditing);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formNotes, setFormNotes] = useState("");
    const [formTransportType, setFormTransportType] = useState<TransportType>("stdio");

    // stdio fields
    const [formCommand, setFormCommand] = useState("");
    const [formArgs, setFormArgs] = useState<string[]>([]);
    const [formEnvVars, setFormEnvVars] = useState<KeyValuePair[]>([]);

    // http/sse fields
    const [formUrl, setFormUrl] = useState("");
    const [formHeaders, setFormHeaders] = useState<KeyValuePair[]>([]);

    useEffect(() => {
        if (isEditing) {
            loadServer();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverId]);

    async function loadServer() {
        try {
            const server = await api.getServer({ serverId: serverId! });
            setFormName(server.name);
            setFormDescription(server.description || "");
            setFormNotes(server.notes || "");

            const transport = server.transport;
            if ("type" in transport && transport.type === "sse") {
                setFormTransportType("sse");
                setFormUrl(transport.url);
                setFormHeaders(
                    transport.headers
                        ? Object.entries(transport.headers).map(([key, value]) => ({
                              id: generateId(),
                              key,
                              value,
                          }))
                        : []
                );
            } else if ("type" in transport && transport.type === "http") {
                setFormTransportType("http");
                setFormUrl(transport.url);
                setFormHeaders(
                    transport.headers
                        ? Object.entries(transport.headers).map(([key, value]) => ({
                              id: generateId(),
                              key,
                              value,
                          }))
                        : []
                );
            } else if ("command" in transport) {
                setFormTransportType("stdio");
                setFormCommand(transport.command);
                setFormArgs(transport.args || []);
                setFormEnvVars(
                    transport.env
                        ? Object.entries(transport.env).map(([key, value]) => ({
                              id: generateId(),
                              key,
                              value,
                          }))
                        : []
                );
            }
        } catch (error) {
            console.error("Failed to load MCP server:", error);
            navigate("/mcp-servers");
        } finally {
            setIsLoading(false);
        }
    }

    function buildTransportConfig(): TransportConfig {
        if (formTransportType === "stdio") {
            const transport: TransportConfig = {
                command: formCommand,
                args: formArgs.filter((a) => a.trim()),
            };
            const env: Record<string, string> = {};
            formEnvVars.forEach(({ key, value }) => {
                if (key.trim()) {
                    env[key.trim()] = value;
                }
            });
            if (Object.keys(env).length > 0) {
                transport.env = env;
            }
            return transport;
        } else if (formTransportType === "sse") {
            const transport: SseTransport = {
                type: "sse",
                url: formUrl,
            };
            const headers: Record<string, string> = {};
            formHeaders.forEach(({ key, value }) => {
                if (key.trim()) {
                    headers[key.trim()] = value;
                }
            });
            if (Object.keys(headers).length > 0) {
                transport.headers = headers;
            }
            return transport;
        } else {
            const transport: HttpTransport = {
                type: "http",
                url: formUrl,
            };
            const headers: Record<string, string> = {};
            formHeaders.forEach(({ key, value }) => {
                if (key.trim()) {
                    headers[key.trim()] = value;
                }
            });
            if (Object.keys(headers).length > 0) {
                transport.headers = headers;
            }
            return transport;
        }
    }

    async function handleSave() {
        setIsSaving(true);
        try {
            const transport = buildTransportConfig();

            if (isEditing) {
                await api.updateServer({
                    serverId: serverId!,
                    updates: {
                        name: formName,
                        description: formDescription || undefined,
                        notes: formNotes || undefined,
                        transport,
                    },
                });
            } else {
                await api.createServer({
                    name: formName,
                    description: formDescription || undefined,
                    notes: formNotes || undefined,
                    transport,
                    enabled: true,
                });
            }
            navigate("/mcp-servers");
        } catch (error) {
            console.error("Failed to save MCP server:", error);
        } finally {
            setIsSaving(false);
        }
    }

    function isFormValid(): boolean {
        if (!formName.trim()) return false;
        if (formTransportType === "stdio") {
            return !!formCommand.trim();
        } else {
            return !!formUrl.trim();
        }
    }

    // Array field helpers
    function addArg() {
        setFormArgs([...formArgs, ""]);
    }

    function updateArg(index: number, value: string) {
        const newArgs = [...formArgs];
        newArgs[index] = value;
        setFormArgs(newArgs);
    }

    function removeArg(index: number) {
        setFormArgs(formArgs.filter((_, i) => i !== index));
    }

    function addEnvVar() {
        setFormEnvVars([...formEnvVars, { id: generateId(), key: "", value: "" }]);
    }

    function updateEnvVar(id: string, field: "key" | "value", value: string) {
        setFormEnvVars(
            formEnvVars.map((env) => (env.id === id ? { ...env, [field]: value } : env))
        );
    }

    function removeEnvVar(id: string) {
        setFormEnvVars(formEnvVars.filter((env) => env.id !== id));
    }

    function addHeader() {
        setFormHeaders([...formHeaders, { id: generateId(), key: "", value: "" }]);
    }

    function updateHeader(id: string, field: "key" | "value", value: string) {
        setFormHeaders(
            formHeaders.map((h) => (h.id === id ? { ...h, [field]: value } : h))
        );
    }

    function removeHeader(id: string) {
        setFormHeaders(formHeaders.filter((h) => h.id !== id));
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
            className="h-full overflow-y-auto"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            {/* Header */}
            <div
                className="sticky top-0 z-10 border-b px-6 py-4"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => navigate("/mcp-servers")}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div>
                            <h1 className="text-xl font-semibold">
                                {isEditing ? "Edit MCP Server" : "New MCP Server"}
                            </h1>
                            <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                Configure a Model Context Protocol server
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => navigate("/mcp-servers")}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={!isFormValid() || isSaving}>
                            {isSaving ? "Saving..." : isEditing ? "Save Changes" : "Create Server"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Form Content */}
            <div className="max-w-2xl mx-auto p-6 space-y-6">
                {/* Basic Info */}
                <Card>
                    <CardHeader>
                        <CardTitle>Basic Information</CardTitle>
                        <CardDescription>Name and description for this MCP server</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Name *</Label>
                            <Input
                                id="name"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g., GitHub MCP"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Input
                                id="description"
                                value={formDescription}
                                onChange={(e) => setFormDescription(e.target.value)}
                                placeholder="e.g., Access GitHub issues and pull requests"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Transport Configuration */}
                <Card>
                    <CardHeader>
                        <CardTitle>Transport</CardTitle>
                        <CardDescription>How to connect to the MCP server</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="transportType">Transport Type</Label>
                            <Select
                                value={formTransportType}
                                onValueChange={(value) => setFormTransportType(value as TransportType)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="stdio">stdio (subprocess)</SelectItem>
                                    <SelectItem value="http">HTTP</SelectItem>
                                    <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {formTransportType === "stdio" ? (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="command">Command *</Label>
                                    <Input
                                        id="command"
                                        value={formCommand}
                                        onChange={(e) => setFormCommand(e.target.value)}
                                        placeholder="e.g., npx"
                                        className="font-mono"
                                    />
                                </div>

                                {/* Arguments */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Arguments</Label>
                                        <Button variant="outline" size="sm" onClick={addArg}>
                                            <Plus className="h-3 w-3 mr-1" />
                                            Add
                                        </Button>
                                    </div>
                                    {formArgs.length === 0 ? (
                                        <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                            No arguments configured
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {formArgs.map((arg, index) => (
                                                <div key={index} className="flex items-center gap-2">
                                                    <Input
                                                        value={arg}
                                                        onChange={(e) => updateArg(index, e.target.value)}
                                                        placeholder={`Argument ${index + 1}`}
                                                        className="font-mono"
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeArg(index)}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Environment Variables */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Environment Variables</Label>
                                        <Button variant="outline" size="sm" onClick={addEnvVar}>
                                            <Plus className="h-3 w-3 mr-1" />
                                            Add
                                        </Button>
                                    </div>
                                    {formEnvVars.length === 0 ? (
                                        <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                            No environment variables configured
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {formEnvVars.map((env) => (
                                                <div key={env.id} className="flex items-center gap-2">
                                                    <Input
                                                        value={env.key}
                                                        onChange={(e) => updateEnvVar(env.id, "key", e.target.value)}
                                                        placeholder="KEY"
                                                        className="font-mono w-1/3"
                                                    />
                                                    <span style={{ color: currentTheme.styles.contentSecondary }}>=</span>
                                                    <Input
                                                        value={env.value}
                                                        onChange={(e) => updateEnvVar(env.id, "value", e.target.value)}
                                                        placeholder="value or ${SECRET_NAME}"
                                                        className="font-mono flex-1"
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeEnvVar(env.id)}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="url">URL *</Label>
                                    <Input
                                        id="url"
                                        value={formUrl}
                                        onChange={(e) => setFormUrl(e.target.value)}
                                        placeholder="https://mcp.example.com/mcp"
                                        className="font-mono"
                                    />
                                </div>

                                {/* Headers */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Headers</Label>
                                        <Button variant="outline" size="sm" onClick={addHeader}>
                                            <Plus className="h-3 w-3 mr-1" />
                                            Add
                                        </Button>
                                    </div>
                                    {formHeaders.length === 0 ? (
                                        <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                            No headers configured
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {formHeaders.map((header) => (
                                                <div key={header.id} className="flex items-center gap-2">
                                                    <Input
                                                        value={header.key}
                                                        onChange={(e) => updateHeader(header.id, "key", e.target.value)}
                                                        placeholder="Header-Name"
                                                        className="font-mono w-1/3"
                                                    />
                                                    <span style={{ color: currentTheme.styles.contentSecondary }}>:</span>
                                                    <Input
                                                        value={header.value}
                                                        onChange={(e) => updateHeader(header.id, "value", e.target.value)}
                                                        placeholder="value or ${SECRET_NAME}"
                                                        className="font-mono flex-1"
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeHeader(header.id)}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        <Alert>
                            <Info className="h-4 w-4" />
                            <AlertDescription className="text-sm">
                                Use <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">{"${SECRET_NAME}"}</code> syntax
                                to reference secrets from your workspace's secrets.json file.
                            </AlertDescription>
                        </Alert>
                    </CardContent>
                </Card>

                {/* Notes */}
                <Card>
                    <CardHeader>
                        <CardTitle>Notes</CardTitle>
                        <CardDescription>Optional notes about this server</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Textarea
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            placeholder="Any notes about setup, required secrets, etc."
                            className="min-h-[80px]"
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export function McpServerFormPage() {
    return (
        <SidebarProvider>
            <div className="flex h-screen w-full overflow-hidden">
                <WorkspaceSidebar />
                <SidebarInset className="flex-1 overflow-hidden">
                    <McpServerFormContent />
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
