import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Alert,
    AlertDescription,
} from "@/components/ui/alert";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useTheme } from "@/hooks/useTheme";
import { useMcpServersAPI } from "@/hooks/useMcpServersAPI";
import type { UserMcpServer, TransportConfig } from "@/features/mcp-servers/mcp-server-types";
import { Plus, Pencil, Trash2, ArrowLeft, Server, AlertTriangle, Globe, Terminal } from "lucide-react";

type TransportType = "stdio" | "sse" | "http";

interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

function McpServersContent() {
    const { currentTheme } = useTheme();
    const navigate = useNavigate();
    const api = useMcpServersAPI();

    const [servers, setServers] = useState<CombinedMcpServer[]>([]);
    const [oauthWarning, setOauthWarning] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirmServer, setDeleteConfirmServer] = useState<CombinedMcpServer | null>(null);

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const response = await api.getAllServers();
            setServers(response.servers);
            setOauthWarning(response.oauthWarning);
        } catch (error) {
            console.error("Failed to load MCP servers:", error);
        } finally {
            setIsLoading(false);
        }
    }

    function getTransportType(transport: TransportConfig): TransportType {
        if ("type" in transport && transport.type === "sse") return "sse";
        if ("type" in transport && transport.type === "http") return "http";
        return "stdio";
    }

    async function handleDelete(server: CombinedMcpServer) {
        try {
            await api.deleteServer({ serverId: server.id });
            setDeleteConfirmServer(null);
            await loadData();
        } catch (error) {
            console.error("Failed to delete MCP server:", error);
        }
    }

    function getTransportIcon(transport: TransportConfig) {
        const type = getTransportType(transport);
        if (type === "stdio") return <Terminal className="h-4 w-4" />;
        return <Globe className="h-4 w-4" />;
    }

    function getTransportLabel(transport: TransportConfig): string {
        const type = getTransportType(transport);
        if (type === "stdio" && "command" in transport) {
            return `${transport.command} ${transport.args?.join(" ") || ""}`.trim();
        } else if ("url" in transport) {
            return transport.url;
        }
        return type.toUpperCase();
    }

    if (isLoading) {
        return (
            <div
                className="flex h-full items-center justify-center"
                style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
            >
                <p style={{ color: currentTheme.styles.contentSecondary }}>Loading MCP servers...</p>
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
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/agents")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                            MCP Servers
                        </h1>
                        <p style={{ color: currentTheme.styles.contentSecondary }}>
                            Configure Model Context Protocol servers for your agents.
                        </p>
                    </div>
                </div>
                <Button onClick={() => navigate("/mcp-servers/new")}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Server
                </Button>
            </div>

            {oauthWarning && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{oauthWarning}</AlertDescription>
                </Alert>
            )}

            <Separator />

            <div className="grid gap-4">
                {servers.length === 0 ? (
                    <div
                        className="text-center py-12"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    >
                        <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No MCP servers configured yet.</p>
                        <p className="text-sm mt-1">Click "New Server" to add one.</p>
                    </div>
                ) : (
                    servers.map((server) => (
                        <Card key={server.id}>
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="flex h-10 w-10 items-center justify-center rounded-lg"
                                            style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                                        >
                                            {getTransportIcon(server.transport)}
                                        </div>
                                        <div>
                                            <CardTitle className="flex items-center gap-2">
                                                {server.name}
                                                {server.isBuiltIn && (
                                                    <Badge variant="secondary">Built-in</Badge>
                                                )}
                                                <Badge variant="outline">
                                                    {getTransportType(server.transport).toUpperCase()}
                                                </Badge>
                                            </CardTitle>
                                            <CardDescription>{server.description || "No description"}</CardDescription>
                                        </div>
                                    </div>
                                    {!server.isBuiltIn && (
                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => navigate(`/mcp-servers/${server.id}/edit`)}
                                                title="Edit"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setDeleteConfirmServer(server)}
                                                title="Delete"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-sm font-mono truncate" style={{ color: currentTheme.styles.contentSecondary }}>
                                    {getTransportLabel(server.transport)}
                                </div>
                                {server.notes && (
                                    <p className="text-xs mt-2" style={{ color: currentTheme.styles.contentTertiary }}>
                                        {server.notes}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteConfirmServer} onOpenChange={() => setDeleteConfirmServer(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete MCP Server</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete "{deleteConfirmServer?.name}"? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirmServer(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteConfirmServer && handleDelete(deleteConfirmServer)}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function McpServersPage() {
    return (
        <SidebarProvider>
            <div className="flex h-screen w-full overflow-hidden">
                <WorkspaceSidebar />
                <SidebarInset className="flex-1 overflow-hidden">
                    <McpServersContent />
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
