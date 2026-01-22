#!/usr/bin/env bun

import { McpServer } from "@socotra/modelcontextprotocol-sdk/server/mcp.js";
import { StdioServerTransport } from "@socotra/modelcontextprotocol-sdk/server/stdio.js";
import { FileDatabase } from "@/storage/FileDatabase";
import { Todo } from "./todo-types";
import { ViewDefinition } from "./view-types";
import path from "path";
import { getNomendexPath, getTodosPath, hasActiveWorkspace, initializePaths } from "@/storage/root-path";
import { z } from "zod";

await initializePaths();
if (!hasActiveWorkspace()) {
    throw new Error("No active workspace configured. Open a workspace before starting the todos MCP server.");
}

// Initialize databases
const todosDb = new FileDatabase<Todo>(path.join(getTodosPath(), "items"));
await todosDb.initialize();
const viewsDb = new FileDatabase<ViewDefinition>(path.join(getNomendexPath(), "views"), { bodyKey: "html" });
await viewsDb.initialize();

// Create MCP server with higher-level API
const server = new McpServer({
    name: "todos-mcp-server",
    version: "1.0.0",
});

// Register list_todos tool
server.registerTool(
    "list_todos",
    {
        title: "List Todos",
        description: "List all todos, optionally filtered by project",
        inputSchema: {
            project: z.string().optional(),
        },
    },
    async (input) => {
        const todos = await todosDb.findAll();
        const activeTodos = todos.filter(t => !t.archived);
        const filteredTodos = input.project
            ? activeTodos.filter(t => t.project === input.project)
            : activeTodos;

        return {
            content: [{
                type: "text",
                text: filteredTodos.map((task) => `- ${task.title} [${task.status}]`).join("\n")
            }]
        };
    }
);

// Register list_projects tool
server.registerTool(
    "list_projects",
    {
        title: "List Projects",
        description: "List all unique project names from todos",
        inputSchema: {},
    },
    async () => {
        const todos = await todosDb.findAll();
        const projects = [...new Set(todos.map(t => t.project).filter(Boolean))];
        return {
            content: [{
                type: "text",
                text: projects.map((project) => `- ${project}`).join("\n")
            }]
        };
    }
);

// Register update_todo tool
server.registerTool(
    "update_todo",
    {
        title: "Update Todo",
        description: "Update a todo item",
        inputSchema: {
            todoId: z.string(),
            updates: z.object({
                title: z.string().optional(),
                description: z.string().optional(),
                status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
                project: z.string().optional(),
            }),
        },
    },
    async (input) => {
        const updated = await todosDb.update(input.todoId, {
            ...input.updates,
            updatedAt: new Date().toISOString(),
        });

        if (!updated) {
            throw new Error(`Todo not found: ${input.todoId}`);
        }

        return {
            content: [{
                type: "text",
                text: `Updated todo: ${updated.title}`
            }]
        };
    }
);

// Register create_todo tool
server.registerTool(
    "create_todo",
    {
        title: "Create Todo",
        description: "Create a new todo item",
        inputSchema: {
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
        },
    },
    async (input) => {
        const now = new Date().toISOString();
        const newTodo: Todo = {
            id: `todo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: input.title,
            description: input.description,
            status: "todo",
            createdAt: now,
            updatedAt: now,
            archived: false,
            project: input.project,
        };

        const created = await todosDb.create(newTodo);
        return {
            content: [{
                type: "text",
                text: `Created todo: ${created.title} (ID: ${created.id})`
            }]
        };
    }
);

function createViewId() {
    return `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function viewSummary(view: ViewDefinition) {
    return {
        id: view.id,
        name: view.name,
        title: view.title,
        height: view.height,
        allowSameOrigin: view.allowSameOrigin,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
    };
}

server.registerTool(
    "save_view",
    {
        title: "Save View",
        description: "Create or update a persistent view that can be reopened later",
        inputSchema: {
            viewId: z.string().optional(),
            name: z.string(),
            html: z.string(),
            title: z.string().optional(),
            height: z.number().optional(),
            allowSameOrigin: z.boolean().optional(),
        },
    },
    async (input) => {
        const now = new Date().toISOString();
        const viewId = input.viewId ?? createViewId();
        const existing = input.viewId ? await viewsDb.findById(viewId) : null;

        const view: ViewDefinition = {
            id: viewId,
            name: input.name,
            html: input.html,
            title: input.title,
            height: input.height,
            allowSameOrigin: input.allowSameOrigin ?? existing?.allowSameOrigin ?? true,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        const saved = existing ? await viewsDb.update(viewId, view) : await viewsDb.create(view);
        if (!saved) {
            throw new Error(`Failed to save view: ${viewId}`);
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(viewSummary(saved), null, 2),
            }],
        };
    }
);

server.registerTool(
    "list_views",
    {
        title: "List Views",
        description: "List all saved views",
        inputSchema: {},
    },
    async () => {
        const views = await viewsDb.findAll();
        views.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        const summaries = views.map(viewSummary);

        return {
            content: [{
                type: "text",
                text: JSON.stringify(summaries, null, 2),
            }],
        };
    }
);

server.registerTool(
    "get_view",
    {
        title: "Get View",
        description: "Get a saved view definition",
        inputSchema: {
            viewId: z.string(),
        },
    },
    async (input) => {
        const view = await viewsDb.findById(input.viewId);
        if (!view) {
            throw new Error(`View not found: ${input.viewId}`);
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(view, null, 2),
            }],
        };
    }
);

server.registerTool(
    "open_view",
    {
        title: "Open View",
        description: "Render a saved view inline",
        inputSchema: {
            viewId: z.string(),
        },
    },
    async (input) => {
        const view = await viewsDb.findById(input.viewId);
        if (!view) {
            throw new Error(`View not found: ${input.viewId}`);
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    __noetect_ui: true,
                    html: view.html,
                    title: view.title || view.name,
                    height: view.height,
                    allowSameOrigin: view.allowSameOrigin ?? true,
                }),
            }],
        };
    }
);

server.registerTool(
    "delete_view",
    {
        title: "Delete View",
        description: "Delete a saved view",
        inputSchema: {
            viewId: z.string(),
        },
    },
    async (input) => {
        const deleted = await viewsDb.delete(input.viewId);
        if (!deleted) {
            throw new Error(`View not found: ${input.viewId}`);
        }

        return {
            content: [{
                type: "text",
                text: `Deleted view: ${input.viewId}`,
            }],
        };
    }
);

// Register resources for all todos programmatically
const todos = await todosDb.findAll();
const activeTodos = todos.filter(t => !t.archived);

for (const todo of activeTodos) {
    server.registerResource(
        `todo-${todo.id}`,
        `todo://${todo.id}`,
        {
            name: todo.title || `Untitled (${todo.id})`,
            description: todo.description,
        },
        async () => {
            // Re-fetch to get latest data
            const latestTodo = await todosDb.findById(todo.id);
            if (!latestTodo) {
                throw new Error(`Todo not found: ${todo.id}`);
            }

            return {
                contents: [{
                    uri: `todo://${todo.id}`,
                    name: latestTodo.title || `Untitled (${todo.id})`,
                    text: JSON.stringify(latestTodo, null, 2),
                }],
            };
        }
    );
}

console.error(`Registered ${activeTodos.length} todo resources`);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Todo MCP server started");
