import * as React from "react";
import { FileText, Settings, Trash2, ListTodo, ListChecks, FolderOpen, Plus, Calendar, CalendarMinus, CalendarPlus, CalendarDays, Save, MessageCircle, AlertTriangle } from "lucide-react";
import { Command as CommandRoot, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { useCommandDialog } from "./CommandDialogProvider";
import { getNotesCommands } from "@/features/notes";
import { getTodosCommands } from "@/features/todos";
import { getChatCommands } from "@/features/chat/commands";
import { getCoreCommands } from "@/commands/core-commands";
import type { Command } from "@/types/Commands";
import { subscribe } from "@/lib/events";
import { SearchNotesDialog } from "@/features/notes/search-notes-dialog";

export function CommandMenu() {
    const [open, setOpen] = React.useState(false);
    const { addNewTab, openTab, setActiveTabId, workspace, closeTab, closeAllTabs, setSidebarTabId, sidebarTabId, setSidebarOpen, sidebarOpen, activeTab } =
        useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
    const { openDialog, closeDialog } = useCommandDialog();
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [featureCommands, setFeatureCommands] = React.useState<Record<string, Command[]>>({});

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    // Listen for search dialog event
    React.useEffect(() => {
        return subscribe("notes:openSearch", () => {
            openDialog({
                title: "Search Notes",
                description: "Search for text across all your notes",
                content: <SearchNotesDialog />,
                size: "jumbo",
            });
        });
    }, [openDialog]);

    // Focus input when dialog opens
    React.useEffect(() => {
        if (open) {
            // Next tick to ensure input exists
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [open]);

    // Load commands from features
    React.useEffect(() => {
        async function loadCommands() {
            const commands: Record<string, Command[]> = {};

            // Core commands (built-in)
            commands["core"] = getCoreCommands({
                openDialog,
                closeDialog,
                closeCommandMenu: () => setOpen(false),
                navigate,
                closeTab,
                closeAllTabs,
                getTabs: () => workspace.tabs,
                setSidebarTabId,
                getSidebarTabId: () => sidebarTabId,
                setSidebarOpen,
                isSidebarOpen: () => sidebarOpen,
                activeTab,
            });

            // Get commands from Todos plugin (placed first for better search priority)
            try {
                const todosCommands = await getTodosCommands({
                    openDialog,
                    closeDialog,
                    closeCommandMenu: () => setOpen(false),
                    addNewTab,
                    openTab,
                    setActiveTabId,
                    closeTab,
                    activeTab,
                    navigate,
                    currentPath,
                });

                if (todosCommands.length > 0) {
                    commands["todos"] = todosCommands;
                }
            } catch (error) {
                console.error("Failed to load todos commands:", error);
            }

            // Get commands from Notes plugin
            const notesCommands = getNotesCommands({
                openDialog,
                closeDialog,
                closeCommandMenu: () => setOpen(false),
                addNewTab,
                openTab,
                setActiveTabId,
                closeTab,
                activeTab,
                navigate,
                currentPath,
            });

            if (notesCommands.length > 0) {
                commands["notes"] = notesCommands;
            }

            // Get commands from Chat feature
            const chatCommands = getChatCommands({
                closeCommandMenu: () => setOpen(false),
                addNewTab,
                openTab,
                setActiveTabId,
                navigate,
                currentPath,
            });

            if (chatCommands.length > 0) {
                commands["chat"] = chatCommands;
            }

            setFeatureCommands(commands);
        }

        loadCommands();
    }, [
        addNewTab,
        openTab,
        setActiveTabId,
        navigate,
        currentPath,
        openDialog,
        closeDialog,
        workspace.tabs,
        closeTab,
        closeAllTabs,
        setSidebarTabId,
        sidebarTabId,
        setSidebarOpen,
        sidebarOpen,
        activeTab,
    ]);

    // Custom filter that prioritizes shorter/exact matches
    const customFilter = React.useCallback((value: string, search: string) => {
        const valueLower = value.toLowerCase();
        const searchLower = search.toLowerCase();

        // Exact match gets highest score
        if (valueLower === searchLower) return 1;

        // Starts with search gets high score
        if (valueLower.startsWith(searchLower)) return 0.9;

        // Contains the search term
        if (valueLower.includes(searchLower)) return 0.5;

        // Check if any word in value starts with search
        const words = valueLower.split(/\s+/);
        for (const word of words) {
            if (word.startsWith(searchLower)) return 0.8;
        }

        return 0;
    }, []);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogHeader className="sr-only">
                <DialogTitle>Command Palette</DialogTitle>
                <DialogDescription>Search for a command to run...</DialogDescription>
            </DialogHeader>
            <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
                <CommandRoot
                    filter={customFilter}
                    className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
                >
                    <CommandInput ref={inputRef} placeholder="Type a command or search..." />
            <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>

                {/* Feature Commands */}
                {Object.entries(featureCommands).map(([featureId, commands]) => {
                    if (commands.length === 0) return null;

                    const feature = featureId.charAt(0).toUpperCase() + featureId.slice(1);
                    return (
                        <React.Fragment key={featureId}>
                            <CommandGroup heading={feature}>
                                {commands
                                    .filter((command) => {
                                        // Filter commands based on when conditions
                                        if (command.when) {
                                            const currentViewId = activeTab?.pluginInstance?.viewId;
                                            const currentPluginId = activeTab?.pluginInstance?.plugin?.id;

                                            // Check activeViewId if specified
                                            if (command.when.activeViewId && currentViewId !== command.when.activeViewId) {
                                                return false;
                                            }
                                            // Check activePluginId if specified
                                            if (command.when.activePluginId && currentPluginId !== command.when.activePluginId) {
                                                return false;
                                            }
                                        }
                                        // Show command if no condition specified or all conditions pass
                                        return true;
                                    })
                                    .map((command) => {
                                        // Map icon names to components
                                        const iconMap = {
                                            Settings,
                                            Trash2,
                                            FileText,
                                            ListTodo,
                                            ListChecks,
                                            FolderOpen,
                                            Plus,
                                            Calendar,
                                            CalendarMinus,
                                            CalendarPlus,
                                            CalendarDays,
                                            Save,
                                            MessageCircle,
                                            AlertTriangle,
                                        };
                                        const IconComponent = iconMap[command.icon as keyof typeof iconMap] || FileText;

                                        // Add keywords for better search matching
                                        let searchValue = command.name;
                                        if (command.id === "notes.open") {
                                            // Short value for best prefix match on "n", "no", "not", "note", "notes"
                                            searchValue = "notes";
                                        } else if (command.id === "notes.openTomorrow") {
                                            // Add "tom" as explicit keyword for tomorrow's note
                                            searchValue = `${command.name} tom tomorrow`;
                                        }

                                        return (
                                            <CommandItem key={command.id} onSelect={command.callback} value={searchValue}>
                                                <IconComponent className="mr-2 h-4 w-4" />
                                                <span>{command.name}</span>
                                            </CommandItem>
                                        );
                                    })}
                            </CommandGroup>
                            <CommandSeparator />
                        </React.Fragment>
                    );
                })}

                {/* Only two groups: core and notes */}
            </CommandList>
                </CommandRoot>
            </DialogContent>
        </Dialog>
    );
}
