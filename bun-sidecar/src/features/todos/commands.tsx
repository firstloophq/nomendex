import React from "react";
import { Command } from "@/types/Commands";
import { CreateTodoCommandDialog } from "./CreateTodoCommandDialog";
import { todosPluginSerial } from "./index";
import { WorkspaceTab } from "@/types/Workspace";
import { SerializablePlugin } from "@/types/Plugin";
import { todosAPI } from "@/hooks/useTodosAPI";

interface CommandContext {
    openDialog: (config: { title?: string; description?: string; content?: React.ReactNode; width?: string }) => void;
    closeDialog: () => void;
    closeCommandMenu: () => void;
    addNewTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    openTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    setActiveTabId: (id: string) => void;
    closeTab: (id: string) => void;
    activeTab?: WorkspaceTab | null;
    navigate: (path: string) => void;
    currentPath: string;
}

export async function getTodosCommands(context: CommandContext): Promise<Command[]> {
    // Fetch available projects
    let projects: string[] = [];
    try {
        projects = await todosAPI.getProjects();
    } catch (error) {
        console.error("Failed to fetch projects for commands:", error);
        projects = [];
    }

    const baseCommands: Command[] = [
        {
            id: "todos.open",
            name: "Open Todos",
            description: "Open the todos default view (projects)",
            icon: "ListTodo",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: todosPluginSerial,
                    view: "default",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "todos.openBrowser",
            name: "Open All Todos",
            description: "Open the todos browser view",
            icon: "ListChecks",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: todosPluginSerial,
                    view: "browser",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "todos.openProjects",
            name: "Open Projects View",
            description: "Open the todos projects view",
            icon: "FolderOpen",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: todosPluginSerial,
                    view: "projects",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "todos.create",
            name: "Create New Todo",
            description: "Create a new todo item",
            icon: "Plus",
            callback: () => {
                context.closeCommandMenu();
                context.openDialog({
                    content: <CreateTodoCommandDialog />,
                    width: '700px',
                });
            },
        },
    ];

    // Add project-specific commands
    const projectCommands: Command[] = projects.map(project => ({
        id: `todos.openProject.${project}`,
        name: `Open Todos: ${project}`,
        description: `Open todos filtered by project "${project}"`,
        icon: "FolderOpen",
        callback: () => {
            context.closeCommandMenu();
            context.openTab({
                pluginMeta: todosPluginSerial,
                view: "browser",
                props: { project },
            });

            // Navigate to workspace if not already there
            if (context.currentPath !== "/") {
                context.navigate("/");
            }
        },
    }));

    return [...baseCommands, ...projectCommands];
}