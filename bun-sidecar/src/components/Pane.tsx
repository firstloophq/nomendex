import { X, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { View } from "./View";
import { useState, useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import { TITLE_BAR_HEIGHT } from "./Layout";
import { Pane as PaneType, WorkspaceTab } from "@/types/Workspace";
import { getIcon } from "./PluginViewIcons";

interface PaneProps {
    pane: PaneType;
    onTabSelect: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabReorder: (fromIndex: number, toIndex: number) => void;
    onPaneFocus: () => void;
    onTabDragStart?: (e: React.DragEvent, tab: WorkspaceTab, index: number, paneId: string) => void;
    onTabDragEnd?: () => void;
    onTabDrop?: (e: React.DragEvent, paneId: string, index: number) => void;
    externalDragState?: {
        isDragging: boolean;
        sourcePaneId: string | null;
        draggedTabIndex: number | null;
    };
}

export function Pane({
    pane,
    onTabSelect,
    onTabClose,
    onTabReorder,
    onPaneFocus,
    onTabDragStart,
    onTabDragEnd,
    onTabDrop,
    externalDragState,
}: PaneProps) {
    const [localDraggedTabIndex, setLocalDraggedTabIndex] = useState<number | null>(null);
    const [dropIndicator, setDropIndicator] = useState<{ index: number; side: "left" | "right" } | null>(null);
    const { currentTheme } = useTheme();

    const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;

    // Use external drag state if provided, otherwise use local state
    const isDraggingFromThisPane = externalDragState
        ? externalDragState.isDragging && externalDragState.sourcePaneId === pane.id
        : localDraggedTabIndex !== null;
    const draggedTabIndex = externalDragState?.sourcePaneId === pane.id
        ? externalDragState.draggedTabIndex
        : localDraggedTabIndex;

    const handleTabDragStart = (e: React.DragEvent, tab: WorkspaceTab, index: number) => {
        if (onTabDragStart) {
            onTabDragStart(e, tab, index, pane.id);
        } else {
            setLocalDraggedTabIndex(index);
            e.dataTransfer.setData("text/plain", String(index));
            e.dataTransfer.effectAllowed = "move";
        }
    };

    const handleTabDragEnd = () => {
        if (onTabDragEnd) {
            onTabDragEnd();
        }
        setLocalDraggedTabIndex(null);
        setDropIndicator(null);
    };

    const handleTabDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        const side = e.clientX < midpoint ? "left" : "right";

        if (dropIndicator?.index !== index || dropIndicator?.side !== side) {
            setDropIndicator({ index, side });
        }
    };

    const handleTabDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();

        if (onTabDrop && externalDragState?.isDragging) {
            // Cross-pane drop
            onTabDrop(e, pane.id, dropIndicator?.side === "right" ? index + 1 : index);
        } else if (localDraggedTabIndex !== null && dropIndicator) {
            // Local reorder
            let toIndex = dropIndicator.side === "right" ? index + 1 : index;
            if (localDraggedTabIndex < toIndex) {
                toIndex -= 1;
            }
            if (localDraggedTabIndex !== toIndex) {
                onTabReorder(localDraggedTabIndex, toIndex);
            }
        }

        setLocalDraggedTabIndex(null);
        setDropIndicator(null);
    };

    // Handle drops on the empty pane area (for cross-pane moves)
    const handlePaneDragOver = (e: React.DragEvent) => {
        if (externalDragState?.isDragging && externalDragState.sourcePaneId !== pane.id) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        }
    };

    const handlePaneDrop = (e: React.DragEvent) => {
        if (onTabDrop && externalDragState?.isDragging && externalDragState.sourcePaneId !== pane.id) {
            e.preventDefault();
            onTabDrop(e, pane.id, pane.tabs.length);
        }
    };

    // Keep CSS variable with tabs header height in sync for plugin sticky headers
    useEffect(() => {
        const header = document.getElementById(`pane-tabs-header-${pane.id}`);
        const scroll = document.getElementById(`pane-tabs-scroll-${pane.id}`);
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
    }, [pane.id]);

    // Show more tabs - up to 20 visible
    const visibleTabs = pane.tabs.slice(0, 20);
    const overflowTabs = pane.tabs.slice(20);
    const hasOverflow = overflowTabs.length > 0;

    if (pane.tabs.length === 0) {
        return (
            <div
                className="flex flex-col h-full w-full items-center justify-center"
                onClick={onPaneFocus}
                onDragOver={handlePaneDragOver}
                onDrop={handlePaneDrop}
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                }}
            >
                <div className="text-center p-6 text-muted-foreground">
                    <p className="text-sm">Empty pane</p>
                    <p className="text-xs mt-1">Drag tabs here or use the command menu</p>
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex flex-col h-full w-full min-w-0"
            onClick={onPaneFocus}
        >
            <Tabs
                value={activeTab?.id || undefined}
                onValueChange={onTabSelect}
                className="flex flex-col h-full min-h-0 overflow-hidden"
            >
                <div
                    className="flex items-center backdrop-blur w-full flex-shrink-0 sticky top-0 z-50"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        height: `${TITLE_BAR_HEIGHT}px`,
                    }}
                    id={`pane-tabs-header-${pane.id}`}
                >
                    <TabsList className="h-full bg-transparent p-0 gap-0 flex-1 min-w-0 flex items-center">
                        {visibleTabs.map((tab, index) => (
                            <div
                                key={tab.id}
                                className="group flex items-center relative"
                                onDragOver={(e) => handleTabDragOver(e, index)}
                                onDrop={(e) => handleTabDrop(e, index)}
                            >
                                {/* Left drop indicator */}
                                {dropIndicator?.index === index && dropIndicator?.side === "left" && draggedTabIndex !== index && (
                                    <div
                                        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full z-10"
                                        style={{ backgroundColor: currentTheme.styles.borderAccent }}
                                    />
                                )}
                                <TabsTrigger
                                    value={tab.id}
                                    className={`rounded-md h-7 mx-0.5 px-2 gap-1.5 flex items-center transition-all duration-200 min-w-0 max-w-[140px] cursor-grab text-xs ${
                                        isDraggingFromThisPane && draggedTabIndex === index ? "opacity-50" : ""
                                    }`}
                                    style={{
                                        backgroundColor: activeTab?.id === tab.id ? currentTheme.styles.surfaceAccent : "transparent",
                                        color: activeTab?.id === tab.id ? currentTheme.styles.contentPrimary : currentTheme.styles.contentSecondary,
                                        borderBottom: activeTab?.id === tab.id ? `2px solid ${currentTheme.styles.borderAccent}` : "2px solid transparent",
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
                                            onTabClose(tab.id);
                                        }}
                                    >
                                        {(() => {
                                            const IconComponent = getIcon(tab.pluginInstance.plugin.icon);
                                            return <IconComponent className="size-3 transition-opacity duration-200 group-hover:opacity-0" />;
                                        })()}
                                        <X
                                            className="size-3 absolute transition-opacity duration-200 opacity-0 group-hover:opacity-100"
                                            style={{ color: currentTheme.styles.semanticDestructive }}
                                        />
                                    </span>
                                    <span className="truncate">{tab.title}</span>
                                </TabsTrigger>
                                {/* Right drop indicator */}
                                {dropIndicator?.index === index && dropIndicator?.side === "right" && draggedTabIndex !== index && (
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
                                        const realIndex = 20 + overflowIndex;
                                        return (
                                            <DropdownMenuItem
                                                key={tab.id}
                                                onClick={() => onTabSelect(tab.id)}
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
                                                        onTabClose(tab.id);
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
                <div
                    className="flex-1 min-h-0 overflow-y-auto [--tabs-height:36px]"
                    id={`pane-tabs-scroll-${pane.id}`}
                    onDragOver={handlePaneDragOver}
                    onDrop={handlePaneDrop}
                >
                    {pane.tabs.map((tab) => (
                        <TabsContent key={tab.id} value={tab.id} className="flex-1 min-h-0 h-full">
                            <View pluginInstance={tab.pluginInstance} viewPosition="main" tabId={tab.id} />
                        </TabsContent>
                    ))}
                </div>
            </Tabs>
        </div>
    );
}
