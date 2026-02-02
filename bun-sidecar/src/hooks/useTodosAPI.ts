import { Todo } from "@/features/todos/todo-types";
import type { Attachment } from "@/types/attachments";

interface CreateTodoInput {
    title: string;
    description?: string;
    project?: string;
    status?: "todo" | "in_progress" | "done" | "later";
    tags?: string[];
    dueDate?: string | null;
    attachments?: Attachment[];
}

interface UpdateTodoInput {
    todoId: string;
    updates: {
        title?: string;
        description?: string;
        status?: "todo" | "in_progress" | "done" | "later";
        project?: string;
        archived?: boolean;
        tags?: string[];
        dueDate?: string | null;
        attachments?: Attachment[];
    };
}

interface ReorderInput {
    reorders: { todoId: string; order: number }[];
}

async function fetchAPI<T>(endpoint: string, body: object = {}): Promise<T> {
    const response = await fetch(`/api/todos/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Convert undefined to null to support explicit field clearing
        // (JSON.stringify drops undefined, preventing backend from receiving cleared fields)
        body: JSON.stringify(body, (key, value) => value === undefined ? null : value),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

// Standalone API object for use outside React components
export const todosAPI = {
    getTodos: (args: { project?: string } = {}) => fetchAPI<Todo[]>("list", args),
    getTodoById: (args: { todoId: string }) => fetchAPI<Todo>("get", args),
    createTodo: (args: CreateTodoInput) => fetchAPI<Todo>("create", args),
    updateTodo: (args: UpdateTodoInput) => fetchAPI<Todo>("update", args),
    deleteTodo: (args: { todoId: string }) => fetchAPI<{ success: boolean }>("delete", args),
    getProjects: () => fetchAPI<string[]>("projects"),
    reorderTodos: (args: ReorderInput) => fetchAPI<{ success: boolean }>("reorder", args),
    archiveTodo: (args: { todoId: string }) => fetchAPI<Todo>("archive", args),
    unarchiveTodo: (args: { todoId: string }) => fetchAPI<Todo>("unarchive", args),
    getArchivedTodos: (args: { project?: string } = {}) => fetchAPI<Todo[]>("archived", args),
    getTags: () => fetchAPI<string[]>("tags"),
};

// Hook wrapper for use in React components
export function useTodosAPI() {
    return todosAPI;
}
