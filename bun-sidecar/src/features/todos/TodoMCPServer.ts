#!/usr/bin/env bun

import { McpServer } from "@socotra/modelcontextprotocol-sdk/server/mcp.js";
import { StdioServerTransport } from "@socotra/modelcontextprotocol-sdk/server/stdio.js";
import { FileDatabase } from "@/storage/FileDatabase";
import { Todo } from "./todo-types";
import { createTodo, updateTodo } from "./fx";
import path from "path";
import { getTodosPath } from "@/storage/root-path";
import { z } from "zod";

// Initialize database
const todosDb = new FileDatabase<Todo>(path.join(getTodosPath(), "items"));
await todosDb.initialize();

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
        description: "Update a todo item. IMPORTANT: If updating project, the project must already exist. Use list_projects first.",
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
        const updated = await updateTodo(input);
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
        description: "Create a new todo item. IMPORTANT: The project must already exist. Use list_projects first to see available projects.",
        inputSchema: {
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
        },
    },
    async (input) => {
        const created = await createTodo(input);
        return {
            content: [{
                type: "text",
                text: `Created todo: ${created.title} (ID: ${created.id})`
            }]
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