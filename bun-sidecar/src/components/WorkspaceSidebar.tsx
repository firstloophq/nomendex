import { useState, useEffect } from "react";
import { Settings, GitBranch, Bot, HelpCircle } from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "./ui/sidebar";
import { baseRegistry } from "@/registry/registry";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { PluginIcon } from "@/types/Plugin";
import { getIcon } from "./PluginViewIcons";
import { useTheme } from "@/hooks/useTheme";
import { TITLE_BAR_HEIGHT } from "./Layout";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function WorkspaceSidebar() {
    const plugins = Object.values(baseRegistry);
    const { workspace, addNewTab, setActiveTabId } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
    const { currentTheme } = useTheme();
    const [appVersion, setAppVersion] = useState("...");

    useEffect(() => {
        fetch("/api/version")
            .then(res => res.json())
            .then(data => setAppVersion(data.version))
            .catch(() => setAppVersion("dev"));
    }, []);

    const handleAddPlugin = async (plugin: { id: string; name: string; icon: PluginIcon }) => {
        // If a tab for this plugin and view already exists, focus it
        const existing = workspace.tabs.find((t) => t.pluginInstance.plugin.id === plugin.id && t.pluginInstance.viewId === "default");

        if (existing) {
            if (currentPath != "/") {
                navigate("/");
            }
            setActiveTabId(existing.id);
            return;
        }

        if (currentPath != "/") {
            navigate("/");
        }

        const newTab = await addNewTab({ pluginMeta: plugin, view: "default", props: {} });
        if (newTab) {
            setActiveTabId(newTab.id);
        }
    };

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    return (
        <Sidebar
            className="backdrop-blur-xl border-r"
            style={{
                backgroundColor: currentTheme.styles.surfaceSecondary,
                borderColor: currentTheme.styles.borderDefault
            }}
        >
            <SidebarHeader
                style={{
                    background: `linear-gradient(to bottom, ${currentTheme.styles.surfaceTertiary}40, transparent)`,
                    height: `${TITLE_BAR_HEIGHT}px`,
                    minHeight: `${TITLE_BAR_HEIGHT}px`,
                }}
            ></SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel style={{ color: currentTheme.styles.contentSecondary }}>Workspace</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {plugins.filter(p => p.id !== 'chat').map((plugin) => {
                                const IconComponent = getIcon(plugin.icon);
                                return (
                                    <SidebarMenuItem key={plugin.id}>
                                        <SidebarMenuButton
                                            onClick={() => handleAddPlugin(plugin)}
                                            className="cursor-pointer transition-all duration-200"
                                            style={{
                                                color: currentTheme.styles.contentPrimary
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <IconComponent className="size-4" />
                                            <span>{plugin.name || plugin.id}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    onClick={() => handleNavigate("/agents")}
                                    className="cursor-pointer transition-all duration-200"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <Bot className="size-4" />
                                    <span>Agents</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            {plugins.filter(p => p.id === 'chat').map((plugin) => {
                                const IconComponent = getIcon(plugin.icon);
                                return (
                                    <SidebarMenuItem key={plugin.id}>
                                        <SidebarMenuButton
                                            onClick={() => handleAddPlugin(plugin)}
                                            className="cursor-pointer transition-all duration-200"
                                            style={{
                                                color: currentTheme.styles.contentPrimary
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <IconComponent className="size-4" />
                                            <span>{plugin.name || plugin.id}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                {plugins.length === 0 && (
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <div
                                className="p-4 text-center text-sm rounded-lg border shadow-sm"
                                style={{
                                    color: currentTheme.styles.contentSecondary,
                                    backgroundColor: currentTheme.styles.surfaceMuted,
                                    borderColor: currentTheme.styles.borderDefault
                                }}
                            >
                                No plugins available
                            </div>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}
            </SidebarContent>

            <SidebarFooter
                style={{
                    background: `linear-gradient(to top, ${currentTheme.styles.surfaceTertiary}40, transparent)`
                }}
            >
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    onClick={() => handleNavigate("/sync")}
                                    className="cursor-pointer transition-all duration-200"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <GitBranch className="size-4" />
                                    <span>Sync</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    onClick={() => handleNavigate("/settings")}
                                    className="cursor-pointer transition-all duration-200"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <Settings className="size-4" />
                                    <span>Settings</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    onClick={() => handleNavigate("/help")}
                                    className="cursor-pointer transition-all duration-200"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <HelpCircle className="size-4" />
                                    <span>Help</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <div className="px-2 py-1">
                    <WorkspaceSwitcher />
                </div>
                <div
                    className="p-2 rounded-lg mx-2 mb-2 border shadow-sm"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceMuted,
                        borderColor: currentTheme.styles.borderDefault
                    }}
                >
                    <div className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                        Noetect v{appVersion}
                    </div>
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
