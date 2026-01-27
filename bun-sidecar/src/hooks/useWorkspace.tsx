import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PluginInstance, PluginBase, SerializablePlugin } from "@/types/Plugin";
import { WorkspaceState, WorkspaceTab, WorkspaceStateSchema, ProjectPreferences, GitAuthMode, NotesLocation, AutoSyncConfig } from "@/types/Workspace";
import { type RouteParams } from "./useRouting";
import { emit } from "@/lib/events";

export function useWorkspace(_initialRoute?: RouteParams) {
    const [workspace, setWorkspace] = useState<WorkspaceState>({
        tabs: [],
        activeTabId: null,
        sidebarOpen: false,
        sidebarTabId: null,
        mcpServerConfigs: [],
        projectPreferences: {},
        gitAuthMode: "local",
        notesLocation: "root",
        autoSync: { enabled: true, syncOnChanges: true, intervalSeconds: 60, paused: false },
        chatInputEnterToSend: true,
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
    const addNewTab = useCallback(
        ({ pluginMeta, view = "default", props = {} }: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => {
            try {
                const pluginInstance = createPluginInstance({ pluginMeta, viewId: view, props });
                const newTab: WorkspaceTab = {
                    id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    title: pluginInstance.plugin.name,
                    pluginInstance,
                };
                updateWorkspace((prev) => ({
                    ...prev,
                    tabs: [...prev.tabs, newTab],
                }));
                return newTab;
            } catch {
                return null;
            }
        },
        [createPluginInstance, updateWorkspace]
    );

    // Opens a new tab AND sets it as active in a single atomic update
    // If a matching tab already exists, focus it instead of creating a duplicate
    const openTab = useCallback(
        ({ pluginMeta, view = "default", props = {} }: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => {
            let resultTab: WorkspaceTab | null = null;

            try {
                updateWorkspace((prev) => {
                    // Check if a matching tab already exists (using latest state from prev)
                    const existingTab = prev.tabs.find(tab => {
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
                    });

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
    // Derived tabs
    const activeTab = useMemo<WorkspaceTab | null>(
        () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null,
        [workspace.tabs, workspace.activeTabId]
    );
    const sidebarTab = useMemo<WorkspaceTab | null>(
        () => workspace.tabs.find((tab) => tab.id === workspace.sidebarTabId) ?? null,
        [workspace.tabs, workspace.sidebarTabId]
    );

    // Explicit setters to avoid effect feedback loops
    const setActiveTabId = useCallback(
        (id: string | null) => {
            updateWorkspace({ activeTabId: id });
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
    const getViewSelfPlacement = useCallback(
        (viewId: string) => {
            let placement: "main" | "sidebar" | null = null;
            if (workspace.activeTabId === viewId) {
                placement = "main";
            } else if (workspace.sidebarTabId === viewId) {
                placement = "sidebar";
            }
            return placement;
        },
        [workspace.activeTabId, workspace.sidebarTabId]
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

    return {
        // State
        workspace,
        loading,
        tabs: workspace.tabs,

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
        activeTabId: workspace.activeTabId,
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
    };
}
