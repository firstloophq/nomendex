import { useState, useCallback, useRef } from "react";
import { Pane } from "./Pane";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { WorkspaceTab } from "@/types/Workspace";

export function SplitLayout() {
    const {
        leftPane,
        rightPane,
        splitRatio,
        setActivePaneId,
        setSplitRatio,
        closeTabInPane,
        setActiveTabInPane,
        reorderTabsInPane,
        moveTabToPane,
    } = useWorkspaceContext();

    const { currentTheme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDraggingDivider, setIsDraggingDivider] = useState(false);

    // Cross-pane drag state
    const [dragState, setDragState] = useState<{
        isDragging: boolean;
        sourcePaneId: string | null;
        draggedTabIndex: number | null;
        draggedTabId: string | null;
    }>({
        isDragging: false,
        sourcePaneId: null,
        draggedTabIndex: null,
        draggedTabId: null,
    });

    // Handle divider drag for resizing panes
    const handleDividerMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            setIsDraggingDivider(true);

            const container = containerRef.current;
            if (!container) return;

            const startX = e.clientX;
            const startRatio = splitRatio;
            const containerWidth = container.getBoundingClientRect().width;

            const handleMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const deltaRatio = deltaX / containerWidth;
                const newRatio = Math.max(0.2, Math.min(0.8, startRatio + deltaRatio));
                setSplitRatio(newRatio);
            };

            const handleMouseUp = () => {
                setIsDraggingDivider(false);
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        },
        [splitRatio, setSplitRatio]
    );

    // Cross-pane tab drag handlers
    const handleTabDragStart = useCallback(
        (e: React.DragEvent, tab: WorkspaceTab, index: number, paneId: string) => {
            e.dataTransfer.setData("application/x-tab-id", tab.id);
            e.dataTransfer.setData("application/x-pane-id", paneId);
            e.dataTransfer.effectAllowed = "move";
            setDragState({
                isDragging: true,
                sourcePaneId: paneId,
                draggedTabIndex: index,
                draggedTabId: tab.id,
            });
        },
        []
    );

    const handleTabDragEnd = useCallback(() => {
        setDragState({
            isDragging: false,
            sourcePaneId: null,
            draggedTabIndex: null,
            draggedTabId: null,
        });
    }, []);

    const handleTabDrop = useCallback(
        (e: React.DragEvent, targetPaneId: string, insertIndex: number) => {
            e.preventDefault();
            const tabId = e.dataTransfer.getData("application/x-tab-id") || dragState.draggedTabId;
            const sourcePaneId = e.dataTransfer.getData("application/x-pane-id") || dragState.sourcePaneId;

            if (tabId && sourcePaneId) {
                if (sourcePaneId === targetPaneId) {
                    // Reorder within same pane
                    const sourcePane = sourcePaneId === leftPane?.id ? leftPane : rightPane;
                    if (sourcePane) {
                        const fromIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
                        if (fromIndex !== -1 && fromIndex !== insertIndex) {
                            let toIndex = insertIndex;
                            if (fromIndex < toIndex) {
                                toIndex -= 1;
                            }
                            reorderTabsInPane(targetPaneId, fromIndex, toIndex);
                        }
                    }
                } else {
                    // Move to different pane
                    moveTabToPane(tabId, targetPaneId, insertIndex);
                }
            }

            setDragState({
                isDragging: false,
                sourcePaneId: null,
                draggedTabIndex: null,
                draggedTabId: null,
            });
        },
        [dragState, leftPane, rightPane, moveTabToPane, reorderTabsInPane]
    );

    if (!leftPane || !rightPane) {
        return null;
    }

    return (
        <div ref={containerRef} className="flex h-full w-full overflow-hidden" style={{ cursor: isDraggingDivider ? "col-resize" : undefined }}>
            {/* Left Pane */}
            <div
                className="h-full min-w-0 overflow-hidden"
                style={{ width: `${splitRatio * 100}%` }}
            >
                <Pane
                    pane={leftPane}
                    onTabSelect={(tabId) => setActiveTabInPane(leftPane.id, tabId)}
                    onTabClose={(tabId) => closeTabInPane(leftPane.id, tabId)}
                    onTabReorder={(from, to) => reorderTabsInPane(leftPane.id, from, to)}
                    onPaneFocus={() => setActivePaneId(leftPane.id)}
                    onTabDragStart={handleTabDragStart}
                    onTabDragEnd={handleTabDragEnd}
                    onTabDrop={handleTabDrop}
                    externalDragState={dragState}
                />
            </div>

            {/* Resizable Divider */}
            <div
                className="flex-shrink-0 w-1 cursor-col-resize group relative"
                style={{ backgroundColor: currentTheme.styles.borderDefault }}
                onMouseDown={handleDividerMouseDown}
            >
                {/* Wider hit area for easier grabbing */}
                <div className="absolute inset-y-0 -left-1 -right-1" />
                {/* Visual indicator on hover */}
                <div
                    className="absolute inset-y-0 left-0 right-0 transition-colors duration-150 group-hover:opacity-100 opacity-0"
                    style={{ backgroundColor: currentTheme.styles.borderAccent }}
                />
            </div>

            {/* Right Pane */}
            <div
                className="h-full min-w-0 overflow-hidden"
                style={{ width: `${(1 - splitRatio) * 100}%` }}
            >
                <Pane
                    pane={rightPane}
                    onTabSelect={(tabId) => setActiveTabInPane(rightPane.id, tabId)}
                    onTabClose={(tabId) => closeTabInPane(rightPane.id, tabId)}
                    onTabReorder={(from, to) => reorderTabsInPane(rightPane.id, from, to)}
                    onPaneFocus={() => setActivePaneId(rightPane.id)}
                    onTabDragStart={handleTabDragStart}
                    onTabDragEnd={handleTabDragEnd}
                    onTabDrop={handleTabDrop}
                    externalDragState={dragState}
                />
            </div>
        </div>
    );
}
