import { X, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { View } from "./View";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { getIcon } from "./PluginViewIcons";
import { useState, useEffect } from "react";
import { WorkspaceTab } from "@/types/Workspace";
import { useTheme } from "@/hooks/useTheme";
import { TITLE_BAR_HEIGHT } from "./Layout";
import { SplitLayout } from "./SplitLayout";

export function Workspace() {
    const { workspace, loading, activeTab, closeTab, setActiveTabId, reorderTabs, layoutMode } =
        useWorkspaceContext();
    const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
    const [dropIndicator, setDropIndicator] = useState<{ index: number; side: 'left' | 'right' } | null>(null);
    const { currentTheme } = useTheme();

    const handleTabDragStart = (e: React.DragEvent, _tab: WorkspaceTab, index: number) => {
        setDraggedTabIndex(index);
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleTabDragEnd = () => {
        setDraggedTabIndex(null);
        setDropIndicator(null);
    };

    const handleTabDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        // Determine if dropping on left or right side of the tab
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        const side = e.clientX < midpoint ? 'left' : 'right';

        if (dropIndicator?.index !== index || dropIndicator?.side !== side) {
            setDropIndicator({ index, side });
        }
    };

    const handleTabDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        const fromIndex = draggedTabIndex;
        if (fromIndex !== null && dropIndicator) {
            // Calculate the actual insertion index
            let toIndex = dropIndicator.side === 'right' ? index + 1 : index;
            // Adjust if dragging from before the drop position
            if (fromIndex < toIndex) {
                toIndex -= 1;
            }
            if (fromIndex !== toIndex) {
                reorderTabs(fromIndex, toIndex);
            }
        }
        setDraggedTabIndex(null);
        setDropIndicator(null);
    };

    // Keep CSS variable with tabs header height in sync for plugin sticky headers
    useEffect(() => {
        const header = document.getElementById("workspace-tabs-header");
        const scroll = document.getElementById("workspace-tabs-scroll");
        if (!header || !scroll) return;
        const setVar = () => {
            const h = header.getBoundingClientRect().height;
            scroll.style.setProperty("--tabs-height", `${h}px`);
        };
        setVar();
        const ro = new ResizeObserver(setVar);
        ro.observe(header);
        window.addEventListener("resize", setVar);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", setVar);
        };
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="max-w-md w-full">
                    <CardContent className="pt-6">
                        <div className="text-center">
                            <div className="animate-pulse text-muted-foreground">Loading workspace...</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // In split mode, render the SplitLayout component
    if (layoutMode === "split") {
        return <SplitLayout />;
    }

    // Single pane mode (default) - original behavior
    if (workspace.tabs.length === 0) {
        return (
            <div className="flex h-full">
                <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex flex-col items-center justify-center flex-1 text-center p-6">
                        <Card className="max-w-md w-full">
                            <CardHeader>
                                <CardTitle>Welcome to your Workspace</CardTitle>
                                <CardDescription>Get started by using the command menu (⌘K) to open notes or todos.</CardDescription>
                            </CardHeader>
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    // Show more tabs - up to 20 visible
    const visibleTabs = workspace.tabs.slice(0, 20);
    const overflowTabs = workspace.tabs.slice(20);
    const hasOverflow = overflowTabs.length > 0;

    return (
        <div className="flex h-full w-full overflow-hidden">
            <div className="flex flex-col flex-1 min-w-0 h-full min-h-0" id="workspace-root">
                <Tabs
                    value={activeTab?.id || undefined}
                    onValueChange={setActiveTabId}
                    className="flex flex-col h-full min-h-0 overflow-hidden"
                >
                    <div
                        className="flex items-center backdrop-blur w-full flex-shrink-0 sticky top-0 z-50"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            height: `${TITLE_BAR_HEIGHT}px`,
                        }}
                        id="workspace-tabs-header"
                    >
                        <TabsList
                            className="h-full bg-transparent p-0 gap-0 flex-1 min-w-0 flex items-center"
                        >
                            {visibleTabs.map((tab, index) => (
                                <div
                                    key={tab.id}
                                    className="group flex items-center relative"
                                    onDragOver={(e) => handleTabDragOver(e, index)}
                                    onDrop={(e) => handleTabDrop(e, index)}
                                >
                                    {/* Left drop indicator */}
                                    {dropIndicator?.index === index && dropIndicator?.side === 'left' && draggedTabIndex !== index && (
                                        <div
                                            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full z-10"
                                            style={{ backgroundColor: currentTheme.styles.borderAccent }}
                                        />
                                    )}
                                    <TabsTrigger
                                        value={tab.id}
                                        className={`rounded-md h-7 mx-0.5 px-2 gap-1.5 flex items-center transition-all duration-200 min-w-0 max-w-[140px] cursor-grab text-xs ${
                                            draggedTabIndex === index ? "opacity-50" : ""
                                        }`}
                                        style={{
                                            backgroundColor: activeTab?.id === tab.id ? currentTheme.styles.surfaceAccent : 'transparent',
                                            color: activeTab?.id === tab.id ? currentTheme.styles.contentPrimary : currentTheme.styles.contentSecondary,
                                            borderBottom: activeTab?.id === tab.id ? `2px solid ${currentTheme.styles.borderAccent}` : '2px solid transparent',
                                            fontWeight: activeTab?.id === tab.id ? 500 : 400,
                                        }}
                                        draggable
                                        onDragStart={(e) => handleTabDragStart(e, tab, index)}
                                        onDragEnd={handleTabDragEnd}
                                    >
                                        <span
                                            className="h-3.5 w-3.5 relative transition-all duration-200 cursor-pointer flex items-center justify-center flex-shrink-0"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                closeTab(tab.id);
                                            }}
                                        >
                                            {(() => {
                                                const IconComponent = getIcon(tab.pluginInstance.plugin.icon);
                                                return <IconComponent className="size-3 transition-opacity duration-200 group-hover:opacity-0" />;
                                            })()}
                                            <X className="size-3 absolute transition-opacity duration-200 opacity-0 group-hover:opacity-100" style={{ color: currentTheme.styles.semanticDestructive }} />
                                        </span>
                                        <span className="truncate">{tab.title}</span>
                                    </TabsTrigger>
                                    {/* Right drop indicator */}
                                    {dropIndicator?.index === index && dropIndicator?.side === 'right' && draggedTabIndex !== index && (
                                        <div
                                            className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full z-10"
                                            style={{ backgroundColor: currentTheme.styles.borderAccent }}
                                        />
                                    )}
                                </div>
                            ))}
                        </TabsList>
                        {hasOverflow && (
                            <div
                                className="flex items-center pr-2 flex-shrink-0"
                                style={{
                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                }}
                            >
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="group relative h-7 px-2 rounded-md transition-all duration-200"
                                            style={{
                                                color: currentTheme.styles.contentSecondary,
                                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                            }}
                                        >
                                            <Plus className="h-3 w-3 mr-0.5" />
                                            <span className="text-xs transition-opacity">{overflowTabs.length}</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-56" style={{ backgroundColor: currentTheme.styles.surfacePrimary }}>
                                        {overflowTabs.map((tab, overflowIndex) => {
                                            const realIndex = 20 + overflowIndex; // Overflow tabs start at index 20
                                            return (
                                            <DropdownMenuItem
                                                key={tab.id}
                                                onClick={() => setActiveTabId(tab.id)}
                                                className="flex items-center justify-between group cursor-move"
                                                draggable
                                                onDragStart={(e) => handleTabDragStart(e, tab, realIndex)}
                                                onDragEnd={handleTabDragEnd}
                                            >
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    {(() => {
                                                        const IconComponent = getIcon(tab.pluginInstance.plugin.icon);
                                                        return <IconComponent className="h-4 w-4 flex-shrink-0" />;
                                                    })()}
                                                    <span className="truncate">{tab.title}</span>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        closeTab(tab.id);
                                                    }}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </DropdownMenuItem>
                                            );
                                        })}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto [--tabs-height:36px] " id="workspace-tabs-scroll">
                        {workspace.tabs.map((tab) => (
                            <TabsContent
                                key={tab.id}
                                value={tab.id}
                                className="flex-1 min-h-0 h-full"
                            >
                                <View pluginInstance={tab.pluginInstance} viewPosition="main" tabId={tab.id} />
                            </TabsContent>
                        ))}
                    </div>
                </Tabs>
            </div>
        </div>
    );
}
