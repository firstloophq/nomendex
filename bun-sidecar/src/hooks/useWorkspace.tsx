import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PluginInstance, PluginBase, SerializablePlugin } from "@/types/Plugin";
import { WorkspaceState, WorkspaceTab, WorkspaceStateSchema, ProjectPreferences, GitAuthMode, NotesLocation, AutoSyncConfig, Pane, LayoutMode } from "@/types/Workspace";
import { type RouteParams } from "./useRouting";
import { emit } from "@/lib/events";

// Helper to generate unique IDs
const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export function useWorkspace(_initialRoute?: RouteParams) {
    const [workspace, setWorkspace] = useState<WorkspaceState>({
        tabs: [],
        activeTabId: null,
        sidebarOpen: false,
        sidebarTabId: null,
        panes: [],
        activePaneId: null,
        splitRatio: 0.5,
        layoutMode: "single",
        mcpServerConfigs: [],
        projectPreferences: {},
        gitAuthMode: "local",
        notesLocation: "root",
        autoSync: { enabled: true, syncOnChanges: true, intervalSeconds: 60, paused: false },
        chatInputEnterToSend: true,
        showHiddenFiles: false,
    });
    const [loading, setLoading] = useState(true);
    const initialRouteHandledRef = useRef(false);

    // Load workspace state from server
    useEffect(() => {
        fetchWorkspace();
    }, []);
    

    // Open initial route if provided (first-load deep link), after workspace loads
    useEffect(() => {
        if (loading || !_initialRoute || initialRouteHandledRef.current) return;
        const { plugin, view, id, ...rest } = _initialRoute;

        // Build instance props for supported features
        const instanceProps: Record<string, unknown> = { ...rest };
        if (plugin === "notes" && id) instanceProps.noteId = id;

        // Create tab
        const pluginMeta: Pick<PluginBase, "id" | "name" | "icon"> = {
            id: plugin,
            name: plugin,
            icon: plugin === "workflows" ? "workflow" : "file",
        } as Pick<PluginBase, "id" | "name" | "icon">;
        addNewTab({ pluginMeta, view: view || "browser", props: instanceProps });
        initialRouteHandledRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, _initialRoute]);

    const fetchWorkspace = async () => {
        console.log("[useWorkspace] Fetching workspace...");
        const response = await fetch("/api/workspace");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log("[useWorkspace] Raw result from server:", result);

        // Handle Result<WorkspaceState> structure
        if (!result.success) {
            throw new Error(result.error || "Failed to fetch workspace");
        }

        const dataValidated = WorkspaceStateSchema.parse(result.data);
        console.log("[useWorkspace] Parsed workspace, chatInputEnterToSend:", dataValidated.chatInputEnterToSend);

        setWorkspace(dataValidated);
        setLoading(false);
    };

    const saveWorkspace = useCallback(async (newWorkspace: WorkspaceState) => {
        console.log("[useWorkspace] Saving workspace, chatInputEnterToSend:", newWorkspace.chatInputEnterToSend);
        console.log("[useWorkspace] Full workspace to save:", newWorkspace);
        const response = await fetch("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newWorkspace),
        });
        if (!response.ok) {
            console.error("[useWorkspace] Save failed with status:", response.status);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log("[useWorkspace] Save response:", result);

        // Handle Result structure
        if (!result.success) {
            throw new Error(result.error || "Failed to save workspace");
        }
    }, []);

    // Centralized updater to avoid sync effects
    const updateWorkspace = useCallback(
        (partialOrUpdater: Partial<WorkspaceState> | ((prev: WorkspaceState) => WorkspaceState)) => {
            setWorkspace((prev) => {
                const nextState =
                    typeof partialOrUpdater === "function"
                        ? (partialOrUpdater as (p: WorkspaceState) => WorkspaceState)(prev)
                        : { ...prev, ...partialOrUpdater };
                void saveWorkspace(nextState);
                return nextState;
            });
        },
        [saveWorkspace]
    );

    const createPluginInstance = useCallback(
        ({
            pluginMeta,
            props,
            viewId = "default",
        }: {
            pluginMeta: SerializablePlugin;
            props: Record<string, unknown>;
            viewId?: string;
        }): PluginInstance => {
            const newPluginInstance: PluginInstance = {
                instanceId: `${pluginMeta.id}-${Date.now()}`,
                plugin: pluginMeta,
                instanceProps: props,
                viewId,
            };
            return newPluginInstance;
        },
        []
    );
    // Note that this does not set the tab as active
    // In split mode, adds to the active pane
    const addNewTab = useCallback(
        ({ pluginMeta, view = "default", props = {} }: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => {
            let resultTab: WorkspaceTab | null = null;
            try {
                const pluginInstance = createPluginInstance({ pluginMeta, viewId: view, props });
                const newTab: WorkspaceTab = {
                    id: generateId("tab"),
                    title: pluginInstance.plugin.name,
                    pluginInstance,
                };
                resultTab = newTab;

                updateWorkspace((prev) => {
                    // In split mode, add to the active pane
                    if (prev.layoutMode === "split") {
                        const targetPaneId = prev.activePaneId ?? prev.panes[0]?.id;
                        if (!targetPaneId) return prev;

                        const newPanes = prev.panes.map((p) =>
                            p.id === targetPaneId ? { ...p, tabs: [...p.tabs, newTab] } : p
                        );
                        return { ...prev, panes: newPanes };
                    }

                    // Single mode: add to legacy tabs
                    return { ...prev, tabs: [...prev.tabs, newTab] };
                });

                return resultTab;
            } catch {
                return null;
            }
        },
        [createPluginInstance, updateWorkspace]
    );

    // Helper to check if a tab matches the given criteria
    const tabMatchesCriteria = (tab: WorkspaceTab, pluginMeta: SerializablePlugin, view: string, props: Record<string, unknown>): boolean => {
        const instance = tab.pluginInstance;

        // Match on plugin ID and view
        if (instance.plugin.id !== pluginMeta.id || instance.viewId !== view) {
            return false;
        }

        // Match on props - do a deep comparison of the key properties
        const existingProps = instance.instanceProps ?? {};

        // For notes: match on noteFileName
        if (pluginMeta.id === "notes" && props.noteFileName) {
            return existingProps.noteFileName === props.noteFileName;
        }

        // For todos: match on project and view type
        if (pluginMeta.id === "todos") {
            // For browser/kanban views, match on project filter
            if (view === "browser" || view === "kanban") {
                return existingProps.project === props.project;
            }
            // For other views (projects, default), just match the view type
            return true;
        }

        // For tags: match on tagName
        if (pluginMeta.id === "tags" && props.tagName) {
            return existingProps.tagName === props.tagName;
        }

        // For chat: match on sessionId
        if (pluginMeta.id === "chat" && view === "chat") {
            // If opening an existing chat (has sessionId), match on sessionId
            if (props.sessionId) {
                return existingProps.sessionId === props.sessionId;
            }
            // If opening a new chat (no sessionId), don't match - allow multiple new chats
            return false;
        }

        // For other plugins, match if view is the same and props are empty or match
        if (Object.keys(props).length === 0 && Object.keys(existingProps).length === 0) {
            return true;
        }

        return false;
    };

    // Opens a new tab AND sets it as active in a single atomic update
    // If a matching tab already exists, focus it instead of creating a duplicate
    // In split mode, opens the tab in the active pane
    const openTab = useCallback(
        ({ pluginMeta, view = "default", props = {} }: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => {
            let resultTab: WorkspaceTab | null = null;

            try {
                updateWorkspace((prev) => {
                    // In split mode, open in the active pane
                    if (prev.layoutMode === "split") {
                        const targetPaneId = prev.activePaneId ?? prev.panes[0]?.id;
                        const targetPane = prev.panes.find((p) => p.id === targetPaneId);
                        if (!targetPane) {
                            return prev;
                        }

                        // Check if matching tab exists in this pane
                        const existingTab = targetPane.tabs.find((tab) => tabMatchesCriteria(tab, pluginMeta, view, props));

                        if (existingTab) {
                            resultTab = existingTab;
                            const newPanes = prev.panes.map((p) =>
                                p.id === targetPaneId ? { ...p, activeTabId: existingTab.id } : p
                            );
                            return { ...prev, panes: newPanes, activePaneId: targetPaneId };
                        }

                        // Create new tab in the pane
                        const pluginInstance = createPluginInstance({ pluginMeta, viewId: view, props });
                        const newTab: WorkspaceTab = {
                            id: generateId("tab"),
                            title: pluginInstance.plugin.name,
                            pluginInstance,
                        };
                        resultTab = newTab;

                        const newPanes = prev.panes.map((p) =>
                            p.id === targetPaneId ? { ...p, tabs: [...p.tabs, newTab], activeTabId: newTab.id } : p
                        );

                        return { ...prev, panes: newPanes, activePaneId: targetPaneId };
                    }

                    // Single mode: use legacy tabs array
                    const existingTab = prev.tabs.find((tab) => tabMatchesCriteria(tab, pluginMeta, view, props));

                    // If matching tab exists, focus it instead of creating new one
                    if (existingTab) {
                        resultTab = existingTab;
                        return {
                            ...prev,
                            activeTabId: existingTab.id,
                        };
                    }

                    // Otherwise create new tab
                    const pluginInstance = createPluginInstance({ pluginMeta, viewId: view, props });
                    const newTab: WorkspaceTab = {
                        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        title: pluginInstance.plugin.name,
                        pluginInstance,
                    };
                    resultTab = newTab;
                    return {
                        ...prev,
                        tabs: [...prev.tabs, newTab],
                        activeTabId: newTab.id,
                    };
                });

                return resultTab;
            } catch {
                return null;
            }
        },
        [createPluginInstance, updateWorkspace]
    );

    const closeTab = useCallback(
        (tabId: string) => {
            updateWorkspace((prev) => {
                const closedIndex = prev.tabs.findIndex((tab) => tab.id === tabId);
                const newTabs = prev.tabs.filter((tab) => tab.id !== tabId);

                // When closing the active tab, select the prior tab (or the next one if closing the first)
                let newActiveTabId = prev.activeTabId;
                if (prev.activeTabId === tabId) {
                    const priorIndex = closedIndex - 1;
                    newActiveTabId = priorIndex >= 0 ? newTabs[priorIndex]?.id ?? null : newTabs[0]?.id ?? null;
                }

                const newSidebarTabId = prev.sidebarTabId === tabId ? null : prev.sidebarTabId;
                return {
                    ...prev,
                    tabs: newTabs,
                    activeTabId: newActiveTabId,
                    sidebarTabId: newSidebarTabId,
                };
            });
        },
        [updateWorkspace]
    );

    // Close all tabs atomically in a single state update
    const closeAllTabs = useCallback(() => {
        // Notify components to close dialogs before tabs close
        emit("workspace:closeAllTabs", {});

        // Small delay to let dialogs close via flushSync before unmounting
        setTimeout(() => {
            updateWorkspace((prev) => ({
                ...prev,
                tabs: [],
                activeTabId: null,
                sidebarTabId: null,
                sidebarOpen: false,
            }));
        }, 10);
    }, [updateWorkspace]);

    // Close all tabs that have a specific note file open
    const closeTabsWithNote = useCallback(
        (noteFileName: string) => {
            updateWorkspace((prev) => {
                // Find all tabs with this note
                const tabsToKeep = prev.tabs.filter((tab) => {
                    const isNotesPlugin = tab.pluginInstance.plugin.id === 'notes';
                    const hasThisNote = tab.pluginInstance.instanceProps?.noteFileName === noteFileName;
                    return !(isNotesPlugin && hasThisNote);
                });

                // If active tab was closed, switch to first remaining tab
                const closedActiveTab = prev.tabs.find(
                    tab => tab.id === prev.activeTabId && 
                    tab.pluginInstance.plugin.id === 'notes' &&
                    tab.pluginInstance.instanceProps?.noteFileName === noteFileName
                );
                const newActiveTabId = closedActiveTab ? (tabsToKeep[0]?.id ?? null) : prev.activeTabId;

                // Clear sidebar if it had this note
                const closedSidebarTab = prev.tabs.find(
                    tab => tab.id === prev.sidebarTabId && 
                    tab.pluginInstance.plugin.id === 'notes' &&
                    tab.pluginInstance.instanceProps?.noteFileName === noteFileName
                );
                const newSidebarTabId = closedSidebarTab ? null : prev.sidebarTabId;

                return {
                    ...prev,
                    tabs: tabsToKeep,
                    activeTabId: newActiveTabId,
                    sidebarTabId: newSidebarTabId,
                };
            });
        },
        [updateWorkspace]
    );

    // Update all tabs that have a specific note file to use a new file name
    const renameNoteTabs = useCallback(
        (oldFileName: string, newFileName: string) => {
            updateWorkspace((prev) => {
                const updatedTabs = prev.tabs.map((tab) => {
                    const isNotesPlugin = tab.pluginInstance.plugin.id === 'notes';
                    const hasThisNote = tab.pluginInstance.instanceProps?.noteFileName === oldFileName;

                    if (isNotesPlugin && hasThisNote) {
                        return {
                            ...tab,
                            pluginInstance: {
                                ...tab.pluginInstance,
                                instanceProps: {
                                    ...tab.pluginInstance.instanceProps,
                                    noteFileName: newFileName,
                                },
                            },
                        };
                    }
                    return tab;
                });

                return {
                    ...prev,
                    tabs: updatedTabs,
                };
            });
        },
        [updateWorkspace]
    );

    const setTabName = useCallback(
        (tabId: string, title: string) => {
            updateWorkspace((prev) => {
                const currentTab = prev.tabs.find((tab) => tab.id === tabId);
                if (currentTab?.title === title) return prev;
                return {
                    ...prev,
                    tabs: prev.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
                };
            });
        },
        [updateWorkspace]
    );

    const updateTabProps = useCallback(
        (tabId: string, props: Record<string, unknown>) => {
            updateWorkspace((prev) => {
                const currentTab = prev.tabs.find((tab) => tab.id === tabId);
                if (!currentTab) return prev;
                return {
                    ...prev,
                    tabs: prev.tabs.map((tab) =>
                        tab.id === tabId
                            ? {
                                ...tab,
                                pluginInstance: {
                                    ...tab.pluginInstance,
                                    instanceProps: {
                                        ...tab.pluginInstance.instanceProps,
                                        ...props,
                                    },
                                },
                            }
                            : tab
                    ),
                };
            });
        },
        [updateWorkspace]
    );

    const closeSidebarTab = useCallback(() => {
        updateWorkspace({ sidebarTabId: null });
    }, [updateWorkspace]);

    const replaceTabWithNewView = useCallback(
        (currentTabId: string, pluginMeta: SerializablePlugin, { view = "default", ...props }: { view?: string; [key: string]: unknown } = {}) => {
            try {
                const pluginInstance = createPluginInstance({ pluginMeta, viewId: view, props });
                let replaced: WorkspaceTab | null = null;
                updateWorkspace((prev) => {
                    // In split mode, look for the tab in panes
                    if (prev.layoutMode === "split") {
                        for (const pane of prev.panes) {
                            const currentTab = pane.tabs.find((tab) => tab.id === currentTabId);
                            if (currentTab) {
                                const newTab: WorkspaceTab = {
                                    id: currentTab.id,
                                    title: pluginInstance.plugin.name,
                                    pluginInstance,
                                };
                                replaced = newTab;
                                const newPanes = prev.panes.map((p) =>
                                    p.id === pane.id
                                        ? { ...p, tabs: p.tabs.map((tab) => (tab.id === currentTabId ? newTab : tab)) }
                                        : p
                                );
                                return { ...prev, panes: newPanes };
                            }
                        }
                        return prev;
                    }

                    // Single mode: use legacy tabs
                    const currentTab = prev.tabs.find((tab) => tab.id === currentTabId);
                    if (!currentTab) {
                        return prev;
                    }
                    const newTab: WorkspaceTab = {
                        id: currentTab.id,
                        title: pluginInstance.plugin.name,
                        pluginInstance,
                    };
                    replaced = newTab;
                    return {
                        ...prev,
                        tabs: prev.tabs.map((tab) => (tab.id === currentTabId ? newTab : tab)),
                    };
                });
                return replaced;
            } catch (error) {
                console.error("Failed to replace tab with new view:", error);
                return null;
            }
        },
        [createPluginInstance, updateWorkspace]
    );
    // Derived tabs - split-mode aware
    const activeTab = useMemo<WorkspaceTab | null>(() => {
        if (workspace.layoutMode === "split") {
            // In split mode, find the active tab in the active pane
            const activePane = workspace.panes.find((p) => p.id === workspace.activePaneId) ?? workspace.panes[0];
            if (activePane) {
                return activePane.tabs.find((tab) => tab.id === activePane.activeTabId) ?? null;
            }
            return null;
        }
        // Single mode: use legacy tabs
        return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null;
    }, [workspace.tabs, workspace.activeTabId, workspace.layoutMode, workspace.panes, workspace.activePaneId]);

    // Computed activeTabId - returns the correct ID based on layout mode
    const currentActiveTabId = useMemo<string | null>(() => {
        if (workspace.layoutMode === "split") {
            const activePane = workspace.panes.find((p) => p.id === workspace.activePaneId) ?? workspace.panes[0];
            return activePane?.activeTabId ?? null;
        }
        return workspace.activeTabId;
    }, [workspace.layoutMode, workspace.panes, workspace.activePaneId, workspace.activeTabId]);

    const sidebarTab = useMemo<WorkspaceTab | null>(
        () => workspace.tabs.find((tab) => tab.id === workspace.sidebarTabId) ?? null,
        [workspace.tabs, workspace.sidebarTabId]
    );

    // Explicit setters to avoid effect feedback loops
    // In split mode, finds which pane has the tab and sets it as active there
    const setActiveTabId = useCallback(
        (id: string | null) => {
            updateWorkspace((prev) => {
                // In split mode, find which pane has this tab and set it as active there
                if (prev.layoutMode === "split") {
                    if (!id) return prev;

                    // Find the pane containing this tab
                    const paneWithTab = prev.panes.find((p) => p.tabs.some((t) => t.id === id));
                    if (paneWithTab) {
                        const newPanes = prev.panes.map((p) =>
                            p.id === paneWithTab.id ? { ...p, activeTabId: id } : p
                        );
                        return { ...prev, panes: newPanes, activePaneId: paneWithTab.id };
                    }
                    return prev;
                }

                // Single mode: set legacy activeTabId
                return { ...prev, activeTabId: id };
            });
        },
        [updateWorkspace]
    );

    const setSidebarTabId = useCallback(
        (id: string | null) => {
            updateWorkspace((prev) => {
                let newActiveTabId = prev.activeTabId;
                
                // If setting sidebar to same ID as current active tab, unset active tab
                if (id && id === prev.activeTabId) {
                    // Find next available tab that's not the sidebar tab
                    const availableTabs = prev.tabs.filter(tab => tab.id !== id);
                    newActiveTabId = availableTabs.length > 0 ? availableTabs[0]?.id ?? null : null;
                }
                
                return { ...prev, sidebarTabId: id, activeTabId: newActiveTabId };
            });
        },
        [updateWorkspace]
    );

    const setSidebarOpen = useCallback(
        (next: boolean | ((prev: boolean) => boolean)) => {
            updateWorkspace((prev) => {
                const nextValue = typeof next === "function" ? (next as (p: boolean) => boolean)(prev.sidebarOpen) : next;
                return { ...prev, sidebarOpen: nextValue };
            });
        },
        [updateWorkspace]
    );

    const setSidebarTab = useCallback(
        (tab: WorkspaceTab | null) => {
            updateWorkspace({ sidebarTabId: tab?.id ?? null });
        },
        [updateWorkspace]
    );

    // These accepts a view id. We check if it is the current `main` view or `right` view and return one of those.
    // This just calculates against workspace and checks for the active id matching
    // In split mode, checks if the tab is active in any pane
    const getViewSelfPlacement = useCallback(
        (viewId: string) => {
            // Check sidebar first (works same in both modes)
            if (workspace.sidebarTabId === viewId) {
                return "sidebar" as const;
            }

            // In split mode, check if tab is active in any pane
            if (workspace.layoutMode === "split") {
                for (const pane of workspace.panes) {
                    if (pane.activeTabId === viewId) {
                        return "main" as const;
                    }
                }
                return null;
            }

            // Single mode: check legacy activeTabId
            if (workspace.activeTabId === viewId) {
                return "main" as const;
            }
            return null;
        },
        [workspace.activeTabId, workspace.sidebarTabId, workspace.layoutMode, workspace.panes]
    );

    // Reorder tabs by moving a tab from one index to another
    const reorderTabs = useCallback(
        (fromIndex: number, toIndex: number) => {
            if (fromIndex === toIndex) return;
            updateWorkspace((prev) => {
                const newTabs = [...prev.tabs];
                const [movedTab] = newTabs.splice(fromIndex, 1);
                if (movedTab) {
                    newTabs.splice(toIndex, 0, movedTab);
                }
                return { ...prev, tabs: newTabs };
            });
        },
        [updateWorkspace]
    );

    // Get project preferences for a specific project
    const getProjectPreferences = useCallback(
        (projectKey: string): ProjectPreferences => {
            return workspace.projectPreferences[projectKey] ?? { hideLaterColumn: false };
        },
        [workspace.projectPreferences]
    );

    // Update project preferences for a specific project
    const setProjectPreferences = useCallback(
        (projectKey: string, preferences: Partial<ProjectPreferences>) => {
            updateWorkspace((prev) => ({
                ...prev,
                projectPreferences: {
                    ...prev.projectPreferences,
                    [projectKey]: {
                        ...prev.projectPreferences[projectKey],
                        hideLaterColumn: preferences.hideLaterColumn ?? prev.projectPreferences[projectKey]?.hideLaterColumn ?? false,
                    },
                },
            }));
        },
        [updateWorkspace]
    );

    // Git auth mode
    const setGitAuthMode = useCallback(
        (mode: GitAuthMode) => {
            updateWorkspace((prev) => ({ ...prev, gitAuthMode: mode }));
        },
        [updateWorkspace]
    );

    // Notes location
    const setNotesLocation = useCallback(
        (location: NotesLocation) => {
            updateWorkspace((prev) => ({ ...prev, notesLocation: location }));
        },
        [updateWorkspace]
    );

    // Auto-sync config
    const setAutoSyncConfig = useCallback(
        (config: Partial<AutoSyncConfig>) => {
            updateWorkspace((prev) => ({
                ...prev,
                autoSync: { ...prev.autoSync, ...config },
            }));
        },
        [updateWorkspace]
    );

    // Chat input preferences
    const setChatInputEnterToSend = useCallback(
        (enabled: boolean) => {
            updateWorkspace((prev) => ({ ...prev, chatInputEnterToSend: enabled }));
        },
        [updateWorkspace]
    );

    // Show hidden files
    const setShowHiddenFiles = useCallback(
        (enabled: boolean) => {
            updateWorkspace((prev) => ({ ...prev, showHiddenFiles: enabled }));
        },
        [updateWorkspace]
    );

    // === Pane Operations ===

    // Create a new pane
    const createPane = useCallback(
        (initialTabs: WorkspaceTab[] = []): Pane => {
            const newPane: Pane = {
                id: generateId("pane"),
                tabs: initialTabs,
                activeTabId: initialTabs[0]?.id ?? null,
            };
            return newPane;
        },
        []
    );

    // Toggle between single and split layout modes
    const toggleLayoutMode = useCallback(() => {
        updateWorkspace((prev) => {
            if (prev.layoutMode === "single") {
                // Switching to split mode
                // If we have no panes, create two: first with existing tabs, second empty
                if (prev.panes.length === 0) {
                    const leftPane: Pane = {
                        id: generateId("pane"),
                        tabs: prev.tabs,
                        activeTabId: prev.activeTabId,
                    };
                    const rightPane: Pane = {
                        id: generateId("pane"),
                        tabs: [],
                        activeTabId: null,
                    };
                    return {
                        ...prev,
                        layoutMode: "split" as LayoutMode,
                        panes: [leftPane, rightPane],
                        activePaneId: leftPane.id,
                    };
                }
                // Panes already exist from previous split, just switch mode
                return {
                    ...prev,
                    layoutMode: "split" as LayoutMode,
                };
            } else {
                // Switching to single mode
                // Merge all pane tabs back into the main tabs array
                const allTabs = prev.panes.flatMap((pane) => pane.tabs);
                const activePane = prev.panes.find((p) => p.id === prev.activePaneId) ?? prev.panes[0];
                const newActiveTabId = activePane?.activeTabId ?? allTabs[0]?.id ?? null;
                return {
                    ...prev,
                    layoutMode: "single" as LayoutMode,
                    tabs: allTabs,
                    activeTabId: newActiveTabId,
                };
            }
        });
    }, [updateWorkspace]);

    // Set the layout mode directly
    const setLayoutMode = useCallback(
        (mode: LayoutMode) => {
            if (mode === workspace.layoutMode) return;
            toggleLayoutMode();
        },
        [workspace.layoutMode, toggleLayoutMode]
    );

    // Set the active pane
    const setActivePaneId = useCallback(
        (paneId: string | null) => {
            updateWorkspace((prev) => ({ ...prev, activePaneId: paneId }));
        },
        [updateWorkspace]
    );

    // Set the split ratio between panes
    const setSplitRatio = useCallback(
        (ratio: number) => {
            const clampedRatio = Math.max(0.2, Math.min(0.8, ratio));
            updateWorkspace((prev) => ({ ...prev, splitRatio: clampedRatio }));
        },
        [updateWorkspace]
    );

    // Move a tab from one pane to another (or within the same pane)
    const moveTabToPane = useCallback(
        (tabId: string, targetPaneId: string, insertIndex?: number) => {
            updateWorkspace((prev) => {
                // Find the source pane and tab
                let sourcePane: Pane | undefined;
                let tab: WorkspaceTab | undefined;

                for (const pane of prev.panes) {
                    const foundTab = pane.tabs.find((t) => t.id === tabId);
                    if (foundTab) {
                        sourcePane = pane;
                        tab = foundTab;
                        break;
                    }
                }

                if (!sourcePane || !tab) return prev;

                const targetPane = prev.panes.find((p) => p.id === targetPaneId);
                if (!targetPane) return prev;

                // Remove from source pane
                const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
                let newSourceActiveTabId = sourcePane.activeTabId;
                if (sourcePane.activeTabId === tabId) {
                    // Select the prior tab, or next, or null
                    const closedIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
                    const priorIndex = closedIndex - 1;
                    newSourceActiveTabId = priorIndex >= 0 ? newSourceTabs[priorIndex]?.id ?? null : newSourceTabs[0]?.id ?? null;
                }

                // Add to target pane
                const newTargetTabs = [...targetPane.tabs];
                const actualIndex = insertIndex !== undefined ? insertIndex : newTargetTabs.length;
                newTargetTabs.splice(actualIndex, 0, tab);

                // Update panes
                const newPanes = prev.panes.map((pane) => {
                    if (pane.id === sourcePane!.id && pane.id === targetPaneId) {
                        // Moving within the same pane
                        return {
                            ...pane,
                            tabs: newTargetTabs,
                            activeTabId: tab!.id, // Set moved tab as active
                        };
                    }
                    if (pane.id === sourcePane!.id) {
                        return {
                            ...pane,
                            tabs: newSourceTabs,
                            activeTabId: newSourceActiveTabId,
                        };
                    }
                    if (pane.id === targetPaneId) {
                        return {
                            ...pane,
                            tabs: newTargetTabs,
                            activeTabId: tab!.id, // Set moved tab as active
                        };
                    }
                    return pane;
                });

                return {
                    ...prev,
                    panes: newPanes,
                    activePaneId: targetPaneId, // Focus the target pane
                };
            });
        },
        [updateWorkspace]
    );

    // Close a tab in a specific pane
    const closeTabInPane = useCallback(
        (paneId: string, tabId: string) => {
            updateWorkspace((prev) => {
                const pane = prev.panes.find((p) => p.id === paneId);
                if (!pane) return prev;

                const closedIndex = pane.tabs.findIndex((t) => t.id === tabId);
                const newTabs = pane.tabs.filter((t) => t.id !== tabId);

                let newActiveTabId = pane.activeTabId;
                if (pane.activeTabId === tabId) {
                    const priorIndex = closedIndex - 1;
                    newActiveTabId = priorIndex >= 0 ? newTabs[priorIndex]?.id ?? null : newTabs[0]?.id ?? null;
                }

                const newPanes = prev.panes.map((p) =>
                    p.id === paneId ? { ...p, tabs: newTabs, activeTabId: newActiveTabId } : p
                );

                return { ...prev, panes: newPanes };
            });
        },
        [updateWorkspace]
    );

    // Set the active tab in a specific pane
    const setActiveTabInPane = useCallback(
        (paneId: string, tabId: string | null) => {
            updateWorkspace((prev) => {
                const newPanes = prev.panes.map((pane) =>
                    pane.id === paneId ? { ...pane, activeTabId: tabId } : pane
                );
                return { ...prev, panes: newPanes, activePaneId: paneId };
            });
        },
        [updateWorkspace]
    );

    // Open a tab in a specific pane (for split mode)
    const openTabInPane = useCallback(
        (
            paneId: string,
            { pluginMeta, view = "default", props = {} }: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }
        ) => {
            let resultTab: WorkspaceTab | null = null;

            updateWorkspace((prev) => {
                const pane = prev.panes.find((p) => p.id === paneId);
                if (!pane) return prev;

                // Check for existing matching tab in this pane
                const existingTab = pane.tabs.find((tab) => {
                    const instance = tab.pluginInstance;
                    if (instance.plugin.id !== pluginMeta.id || instance.viewId !== view) {
                        return false;
                    }
                    const existingProps = instance.instanceProps ?? {};
                    if (pluginMeta.id === "notes" && props.noteFileName) {
                        return existingProps.noteFileName === props.noteFileName;
                    }
                    if (pluginMeta.id === "todos") {
                        if (view === "browser" || view === "kanban") {
                            return existingProps.project === props.project;
                        }
                        return true;
                    }
                    if (pluginMeta.id === "tags" && props.tagName) {
                        return existingProps.tagName === props.tagName;
                    }
                    if (pluginMeta.id === "chat" && view === "chat") {
                        if (props.sessionId) {
                            return existingProps.sessionId === props.sessionId;
                        }
                        return false;
                    }
                    if (Object.keys(props).length === 0 && Object.keys(existingProps).length === 0) {
                        return true;
                    }
                    return false;
                });

                if (existingTab) {
                    resultTab = existingTab;
                    const newPanes = prev.panes.map((p) =>
                        p.id === paneId ? { ...p, activeTabId: existingTab.id } : p
                    );
                    return { ...prev, panes: newPanes, activePaneId: paneId };
                }

                // Create new tab
                const pluginInstance = createPluginInstance({ pluginMeta, viewId: view, props });
                const newTab: WorkspaceTab = {
                    id: generateId("tab"),
                    title: pluginInstance.plugin.name,
                    pluginInstance,
                };
                resultTab = newTab;

                const newPanes = prev.panes.map((p) =>
                    p.id === paneId ? { ...p, tabs: [...p.tabs, newTab], activeTabId: newTab.id } : p
                );

                return { ...prev, panes: newPanes, activePaneId: paneId };
            });

            return resultTab;
        },
        [createPluginInstance, updateWorkspace]
    );

    // Reorder tabs within a pane
    const reorderTabsInPane = useCallback(
        (paneId: string, fromIndex: number, toIndex: number) => {
            if (fromIndex === toIndex) return;
            updateWorkspace((prev) => {
                const pane = prev.panes.find((p) => p.id === paneId);
                if (!pane) return prev;

                const newTabs = [...pane.tabs];
                const [movedTab] = newTabs.splice(fromIndex, 1);
                if (movedTab) {
                    newTabs.splice(toIndex, 0, movedTab);
                }

                const newPanes = prev.panes.map((p) =>
                    p.id === paneId ? { ...p, tabs: newTabs } : p
                );

                return { ...prev, panes: newPanes };
            });
        },
        [updateWorkspace]
    );

    // Get pane by ID
    const getPane = useCallback(
        (paneId: string): Pane | undefined => {
            return workspace.panes.find((p) => p.id === paneId);
        },
        [workspace.panes]
    );

    // Get the active pane
    const activePane = useMemo<Pane | null>(() => {
        if (workspace.layoutMode === "single") return null;
        return workspace.panes.find((p) => p.id === workspace.activePaneId) ?? workspace.panes[0] ?? null;
    }, [workspace.panes, workspace.activePaneId, workspace.layoutMode]);

    // Get left and right panes
    const leftPane = useMemo<Pane | null>(() => workspace.panes[0] ?? null, [workspace.panes]);
    const rightPane = useMemo<Pane | null>(() => workspace.panes[1] ?? null, [workspace.panes]);

    // Computed tabs - returns all tabs from panes in split mode, or legacy tabs in single mode
    const allTabs = useMemo<WorkspaceTab[]>(() => {
        if (workspace.layoutMode === "split") {
            return workspace.panes.flatMap((p) => p.tabs);
        }
        return workspace.tabs;
    }, [workspace.layoutMode, workspace.panes, workspace.tabs]);

    return {
        // State
        workspace,
        loading,
        tabs: allTabs,

        // Actions
        addNewTab,
        openTab,
        closeTab,
        closeAllTabs,
        closeTabsWithNote,
        renameNoteTabs,
        setTabName,
        updateTabProps,
        reorderTabs,
        updateWorkspace,

        // Utilities
        createPluginInstance,
        refetch: fetchWorkspace,

        // Sidebar state
        setSidebarOpen,
        setSidebarTab,
        sidebarOpen: workspace.sidebarOpen,
        closeSidebarTab,
        activeTab,
        sidebarTab,
        setSidebarTabId,
        activeTabId: currentActiveTabId,
        setActiveTabId,
        sidebarTabId: workspace.sidebarTabId,
        replaceTabWithNewView,
        getViewSelfPlacement,

        // Project preferences
        projectPreferences: workspace.projectPreferences,
        getProjectPreferences,
        setProjectPreferences,

        // Git auth mode
        gitAuthMode: workspace.gitAuthMode,
        setGitAuthMode,

        // Notes location
        notesLocation: workspace.notesLocation,
        setNotesLocation,

        // Auto-sync
        autoSync: workspace.autoSync,
        setAutoSyncConfig,

        // Chat input preferences
        chatInputEnterToSend: workspace.chatInputEnterToSend,
        setChatInputEnterToSend,

        // Show hidden files
        showHiddenFiles: workspace.showHiddenFiles,
        setShowHiddenFiles,

        // Pane operations
        panes: workspace.panes,
        activePaneId: workspace.activePaneId,
        activePane,
        leftPane,
        rightPane,
        splitRatio: workspace.splitRatio,
        layoutMode: workspace.layoutMode,
        createPane,
        toggleLayoutMode,
        setLayoutMode,
        setActivePaneId,
        setSplitRatio,
        moveTabToPane,
        closeTabInPane,
        setActiveTabInPane,
        openTabInPane,
        reorderTabsInPane,
        getPane,
    };
}
