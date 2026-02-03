import { McpServer } from "@socotra/modelcontextprotocol-sdk/server/mcp.js";
import { StdioServerTransport } from "@socotra/modelcontextprotocol-sdk/server/stdio.js";
import { createTodo, getProjects, getTodos, updateTodo } from "./fx";
import { z } from "zod";

const server = new McpServer({
    name: "task-mcp-server",
    version: "0.1.0",
});
server.registerTool(
    "list_todos",
    {
        title: "List Todos",
        description: "List all todos",
        inputSchema: {
            project: z.string().optional(),
        },
    },
    async (input) => {
        const brief = await getTodos({ project: input.project });
        console.log({ brief });
        // console.log()
        return { content: [{ type: "text", text: brief.map((task) => `- ${task.title}`).join("\n") }] };
    }
);
server.registerTool(
    "list_projects",
    {
        title: "List Projects",
        description: "List all projects",
        inputSchema: {},
    },
    async () => {
        const projects = await getProjects();
        return { content: [{ type: "text", text: projects.map((project) => `- ${project}`).join("\n") }] };
    }
);
// Now implement updating the todo.
// It should accept the values from the fx for the updateTodo function.
server.registerTool(
    "update_todo",
    {
        title: "Update Todo",
        description: "Update a todo. IMPORTANT: If updating project, the project must already exist. Use list_projects first.",
        inputSchema: {
            todoId: z.string(),
            updates: z.object({
                title: z.string().optional(),
                description: z.string().optional(),
                status: z.enum(["todo", "in_progress", "done"]).optional(),
                project: z.string().optional(),
            }),
        },
    },
    async (input) => {
        const updated = await updateTodo(input);
        return { content: [{ type: "text", text: `Updated todo: ${updated.title}` }] };
    }
);
// Create todo tool implementation
server.registerTool(
    "create_todo",
    {
        title: "Create Todo",
        description: "Create a new todo. IMPORTANT: The project must already exist. Use list_projects first to see available projects.",
        inputSchema: {
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
        },
    },
    async (input) => {
        const created = await createTodo(input);
        return { content: [{ type: "text", text: `Created todo: ${created.title}` }] };
    }
);
server.registerResource("test-task-resource", "task://test", { name: "test" }, async (uri) => {
    return {
        contents: [
            {
                uri: uri.toString(),
                text: "This is a test resource",
            },
        ],
    };
});

const transport = new StdioServerTransport();
await server.connect(transport);
