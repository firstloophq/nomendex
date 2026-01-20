import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import { TodosView } from "./view";
import { TodosBrowserView } from "./browser-view";
import { ProjectBrowserView } from "./ProjectBrowserView";
import { ArchivedBrowserView } from "./archived-view";
import { FunctionStubs } from "@/types/Functions";
import { TodoSchema } from "./todo-types";
import { AttachmentSchema } from "@/types/attachments";

// Export the commands function for use in CommandMenu
export { getTodosCommands } from "./commands";

export const functionStubs = {
    getTodos: {
        input: z.object({
            project: z.string().optional(),
        }),
        output: z.array(TodoSchema),
    },
    getProjects: {
        input: z.object({}),
        output: z.array(z.string()),
    },
    getTodoById: {
        input: z.object({ todoId: z.string() }),
        output: TodoSchema,
    },
    createTodo: {
        input: z.object({
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
            status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
            tags: z.array(z.string()).optional(),
            dueDate: z.string().optional(),
            attachments: z.array(AttachmentSchema).optional(),
        }),
        output: TodoSchema,
    },
    updateTodo: {
        input: z.object({
            todoId: z.string(),
            updates: z.object({
                title: z.string().optional(),
                description: z.string().optional(),
                status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
                project: z.string().optional(),
                archived: z.boolean().optional(),
                tags: z.array(z.string()).optional(),
                dueDate: z.string().optional(),
                attachments: z.array(AttachmentSchema).optional(),
            }),
        }),
        output: TodoSchema,
    },
    deleteTodo: {
        input: z.object({ todoId: z.string() }),
        output: z.object({ success: z.boolean() }),
    },
    reorderTodos: {
        input: z.object({
            reorders: z.array(z.object({
                todoId: z.string(),
                order: z.number(),
            })),
        }),
        output: z.object({ success: z.boolean() }),
    },
    archiveTodo: {
        input: z.object({ todoId: z.string() }),
        output: TodoSchema,
    },
    unarchiveTodo: {
        input: z.object({ todoId: z.string() }),
        output: TodoSchema,
    },
    getArchivedTodos: {
        input: z.object({
            project: z.string().optional(),
        }),
        output: z.array(TodoSchema),
    },
    getTags: {
        input: z.object({}),
        output: z.array(z.string()),
    },
} satisfies FunctionStubs;

export const todosPluginSerial: SerializablePlugin = {
    id: "todos",
    name: "Todos",
    icon: "list-todo",
};

export const todosViewPropsSchema = z.object({
    todoId: z.string(),
});
export type TodosViewProps = z.infer<typeof todosViewPropsSchema>;

export const todosBrowserViewPropsSchema = z.object({
    project: z.string().optional(),
    selectedTodoId: z.string().optional(),
});
export type TodosBrowserViewProps = z.infer<typeof todosBrowserViewPropsSchema>;

const views = {
    default: {
        id: "default",
        name: "Projects",
        component: ProjectBrowserView,
    },
    browser: {
        id: "browser",
        name: "Todos",
        component: TodosBrowserView,
        props: todosBrowserViewPropsSchema,
    },
    archived: {
        id: "archived",
        name: "Archived",
        component: ArchivedBrowserView,
        props: todosBrowserViewPropsSchema,
    },
    projects: {
        id: "projects",
        name: "Projects",
        component: ProjectBrowserView,
    },
    editor: {
        id: "editor",
        name: "Todo Details",
        component: TodosView,
        props: todosViewPropsSchema,
    },
} as const;

export const TodosPluginBase: PluginBase = {
    id: todosPluginSerial.id,
    name: todosPluginSerial.name,
    icon: todosPluginSerial.icon,
    views,
    mcpServers: {}, // MCP servers are defined in fx.ts to keep them backend-only
    functionStubs,
    commands: [
        {
            id: "todos.open",
            name: "Open Todos",
            description: "Open the todos kanban board",
            icon: "CheckSquare",
            callback: () => {
                // This will be handled by CommandMenu
            },
        },
        {
            id: "todos.create",
            name: "Create New Todo",
            description: "Create a new todo item",
            icon: "Plus",
            callback: () => {
                // This will be handled by CommandMenu
            },
        },
    ],
};
