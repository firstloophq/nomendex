import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { useKeybindings, Keybinding } from "@/hooks/useKeybindings";
import { useWorkspaceContext } from "./WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { emit } from "@/lib/events";

interface KeyboardShortcut {
    id: string;
    name: string;
    description: string;
    defaultKeys: string[];
    customKeys?: string[];
    category: "tabs" | "navigation" | "workspace" | "custom" | "editor" | "search";
    action?: () => void;
    /** If true, this shortcut is handled elsewhere (e.g., ProseMirror) and shown for documentation only */
    documentationOnly?: boolean;
}

interface KeyboardShortcutsContextType {
    shortcuts: KeyboardShortcut[];
    updateShortcut: (id: string, keys: string[]) => void;
    resetShortcut: (id: string) => void;
    resetAllShortcuts: () => void;
    getShortcutKeys: (id: string) => string[];
    getShortcutByKeys: (keys: string[]) => KeyboardShortcut | undefined;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextType | null>(null);

interface KeyboardShortcutsProviderProps {
    children: React.ReactNode;
}

const STORAGE_KEY = "keyboard-shortcuts";

export function KeyboardShortcutsProvider({ children }: KeyboardShortcutsProviderProps) {
    const { 
        workspace, 
        closeTab, 
        setActiveTabId, 
        activeTab
    } = useWorkspaceContext();
    const { navigate } = useRouting();

    // Default shortcuts configuration
    const defaultShortcuts = useMemo<KeyboardShortcut[]>(() => [
        // Tab Management
        {
            id: "close-tab",
            name: "Close Tab",
            description: "Close the current active tab",
            defaultKeys: ["cmd", "w"],
            category: "tabs",
        },
        {
            id: "next-tab",
            name: "Next Tab",
            description: "Switch to the next tab",
            defaultKeys: ["ctrl", "tab"],
            category: "tabs",
        },
        {
            id: "prev-tab",
            name: "Previous Tab",
            description: "Switch to the previous tab",
            defaultKeys: ["ctrl", "shift", "tab"],
            category: "tabs",
        },
        {
            id: "tab-1",
            name: "Go to Tab 1",
            description: "Switch to the first tab",
            defaultKeys: ["cmd", "1"],
            category: "tabs",
        },
        {
            id: "tab-2",
            name: "Go to Tab 2",
            description: "Switch to the second tab",
            defaultKeys: ["cmd", "2"],
            category: "tabs",
        },
        {
            id: "tab-3",
            name: "Go to Tab 3",
            description: "Switch to the third tab",
            defaultKeys: ["cmd", "3"],
            category: "tabs",
        },
        {
            id: "tab-4",
            name: "Go to Tab 4",
            description: "Switch to the fourth tab",
            defaultKeys: ["cmd", "4"],
            category: "tabs",
        },
        {
            id: "tab-5",
            name: "Go to Tab 5",
            description: "Switch to the fifth tab",
            defaultKeys: ["cmd", "5"],
            category: "tabs",
        },
        {
            id: "tab-6",
            name: "Go to Tab 6",
            description: "Switch to the sixth tab",
            defaultKeys: ["cmd", "6"],
            category: "tabs",
        },
        {
            id: "tab-7",
            name: "Go to Tab 7",
            description: "Switch to the seventh tab",
            defaultKeys: ["cmd", "7"],
            category: "tabs",
        },
        {
            id: "tab-8",
            name: "Go to Tab 8",
            description: "Switch to the eighth tab",
            defaultKeys: ["cmd", "8"],
            category: "tabs",
        },
        {
            id: "last-tab",
            name: "Go to Last Tab",
            description: "Switch to the last tab",
            defaultKeys: ["cmd", "9"],
            category: "tabs",
        },
        // Navigation
        {
            id: "go-to-settings",
            name: "Open Settings",
            description: "Navigate to settings page",
            defaultKeys: ["cmd", "comma"],
            category: "navigation",
        },
        // Search
        {
            id: "search-notes",
            name: "Search Notes",
            description: "Search across all notes",
            defaultKeys: ["cmd", "shift", "f"],
            category: "search",
        },
        // Editor - Table shortcuts (handled by ProseMirror, shown for documentation)
        {
            id: "table-next-cell",
            name: "Next Cell",
            description: "Move to the next table cell",
            defaultKeys: ["tab"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-prev-cell",
            name: "Previous Cell",
            description: "Move to the previous table cell",
            defaultKeys: ["shift", "tab"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-add-column-after",
            name: "Add Column After",
            description: "Insert a new column after the current one",
            defaultKeys: ["cmd", "shift", "right"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-add-column-before",
            name: "Add Column Before",
            description: "Insert a new column before the current one",
            defaultKeys: ["cmd", "shift", "left"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-delete-column",
            name: "Delete Column",
            description: "Delete the current column",
            defaultKeys: ["cmd", "alt", "backspace"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-add-row",
            name: "Add Row",
            description: "Add a new row (when in last column)",
            defaultKeys: ["enter"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-delete-row",
            name: "Delete Row",
            description: "Delete the current row",
            defaultKeys: ["cmd", "shift", "backspace"],
            category: "editor",
            documentationOnly: true,
        },
        {
            id: "table-delete-table",
            name: "Delete Table",
            description: "Delete the entire table",
            defaultKeys: ["cmd", "shift", "alt", "backspace"],
            category: "editor",
            documentationOnly: true,
        },
    ], []);

    // Load saved shortcuts from localStorage
    const loadShortcuts = useCallback((): KeyboardShortcut[] => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return defaultShortcuts;
            
            const parsed = JSON.parse(stored);
            // Merge with defaults to ensure new shortcuts are included
            return defaultShortcuts.map(defaultShortcut => {
                const saved = parsed.find((s: KeyboardShortcut) => s.id === defaultShortcut.id);
                return saved ? { ...defaultShortcut, customKeys: saved.customKeys } : defaultShortcut;
            });
        } catch {
            return defaultShortcuts;
        }
    }, [defaultShortcuts]);

    const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>(loadShortcuts);

    // Save shortcuts to localStorage whenever they change
    useEffect(() => {
        const toSave = shortcuts
            .filter(s => s.customKeys && s.customKeys.length > 0)
            .map(s => ({ id: s.id, customKeys: s.customKeys }));
        
        if (toSave.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }, [shortcuts]);

    // Actions for shortcuts
    const actions = useMemo(() => {
        const visibleTabs = workspace.tabs.filter(tab => tab.id !== workspace.sidebarTabId);
        
        return {
            "close-tab": () => {
                if (activeTab) {
                    closeTab(activeTab.id);
                }
            },
            "next-tab": () => {
                console.log('next-tab handler called, visibleTabs:', visibleTabs.length);
                if (visibleTabs.length === 0) return;
                const currentIndex = visibleTabs.findIndex(tab => tab.id === activeTab?.id);
                const nextIndex = (currentIndex + 1) % visibleTabs.length;
                const nextTab = visibleTabs[nextIndex];
                console.log('Switching to next tab:', nextTab?.id);
                if (nextTab) setActiveTabId(nextTab.id);
            },
            "prev-tab": () => {
                console.log('prev-tab handler called, visibleTabs:', visibleTabs.length);
                if (visibleTabs.length === 0) return;
                const currentIndex = visibleTabs.findIndex(tab => tab.id === activeTab?.id);
                const prevIndex = currentIndex === 0 ? visibleTabs.length - 1 : currentIndex - 1;
                const prevTab = visibleTabs[prevIndex];
                console.log('Switching to prev tab:', prevTab?.id);
                if (prevTab) setActiveTabId(prevTab.id);
            },
            "tab-1": () => { if (visibleTabs[0]) setActiveTabId(visibleTabs[0].id); },
            "tab-2": () => { if (visibleTabs[1]) setActiveTabId(visibleTabs[1].id); },
            "tab-3": () => { if (visibleTabs[2]) setActiveTabId(visibleTabs[2].id); },
            "tab-4": () => { if (visibleTabs[3]) setActiveTabId(visibleTabs[3].id); },
            "tab-5": () => { if (visibleTabs[4]) setActiveTabId(visibleTabs[4].id); },
            "tab-6": () => { if (visibleTabs[5]) setActiveTabId(visibleTabs[5].id); },
            "tab-7": () => { if (visibleTabs[6]) setActiveTabId(visibleTabs[6].id); },
            "tab-8": () => { if (visibleTabs[7]) setActiveTabId(visibleTabs[7].id); },
            "last-tab": () => {
                if (visibleTabs.length > 0) {
                    const lastTab = visibleTabs[visibleTabs.length - 1];
                    if (lastTab) setActiveTabId(lastTab.id);
                }
            },
            "go-to-settings": () => navigate("/settings"),
            "search-notes": () => emit("notes:openSearch", {}),
        };
    }, [workspace.tabs, workspace.sidebarTabId, activeTab, closeTab, setActiveTabId, navigate]);

    // Create keybindings from shortcuts (exclude documentation-only shortcuts)
    const keybindings = useMemo<Keybinding[]>(() =>
        shortcuts
            .filter(shortcut => !shortcut.documentationOnly && actions[shortcut.id as keyof typeof actions])
            .map(shortcut => ({
                id: shortcut.id,
                keys: shortcut.customKeys || shortcut.defaultKeys,
                description: shortcut.description,
                action: actions[shortcut.id as keyof typeof actions],
                enabled: true,
                preventDefault: true,
            })),
        [shortcuts, actions]
    );

    // Apply the keybindings
    useKeybindings(keybindings);

    // Context methods
    const updateShortcut = useCallback((id: string, keys: string[]) => {
        setShortcuts(prev => prev.map(s => 
            s.id === id ? { ...s, customKeys: keys } : s
        ));
    }, []);

    const resetShortcut = useCallback((id: string) => {
        setShortcuts(prev => prev.map(s => 
            s.id === id ? { ...s, customKeys: undefined } : s
        ));
    }, []);

    const resetAllShortcuts = useCallback(() => {
        setShortcuts(defaultShortcuts);
        localStorage.removeItem(STORAGE_KEY);
    }, [defaultShortcuts]);

    const getShortcutKeys = useCallback((id: string): string[] => {
        const shortcut = shortcuts.find(s => s.id === id);
        return shortcut?.customKeys || shortcut?.defaultKeys || [];
    }, [shortcuts]);

    const getShortcutByKeys = useCallback((keys: string[]): KeyboardShortcut | undefined => {
        return shortcuts.find(s => {
            const shortcutKeys = s.customKeys || s.defaultKeys;
            return shortcutKeys.length === keys.length && 
                   shortcutKeys.every((key, i) => key === keys[i]);
        });
    }, [shortcuts]);

    const value = useMemo<KeyboardShortcutsContextType>(() => ({
        shortcuts,
        updateShortcut,
        resetShortcut,
        resetAllShortcuts,
        getShortcutKeys,
        getShortcutByKeys,
    }), [shortcuts, updateShortcut, resetShortcut, resetAllShortcuts, getShortcutKeys, getShortcutByKeys]);

    return (
        <KeyboardShortcutsContext.Provider value={value}>
            {children}
        </KeyboardShortcutsContext.Provider>
    );
}

export function useKeyboardShortcuts() {
    const context = useContext(KeyboardShortcutsContext);
    if (!context) {
        throw new Error("useKeyboardShortcuts must be used within KeyboardShortcutsProvider");
    }
    return context;
}