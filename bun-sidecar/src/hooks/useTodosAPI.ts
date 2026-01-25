import { Todo } from "@/features/todos/todo-types";
import type { Attachment } from "@/types/attachments";
import type { BoardConfig } from "@/features/todos/board-types";

interface CreateTodoInput {
    title: string;
    description?: string;
    project?: string;
    status?: "todo" | "in_progress" | "done" | "later";
    tags?: string[];
    dueDate?: string;
    attachments?: Attachment[];
    customColumnId?: string;
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
        dueDate?: string;
        attachments?: Attachment[];
        customColumnId?: string;
    };
}

interface ReorderInput {
    reorders: { todoId: string; order: number }[];
}

async function fetchAPI<T>(endpoint: string, body: object = {}): Promise<T> {
    const response = await fetch(`/api/todos/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    getBoardConfig: (args: { projectId: string }) => fetchAPI<BoardConfig | null>("board-config/get", args),
    saveBoardConfig: (args: { config: BoardConfig }) => fetchAPI<BoardConfig>("board-config/save", args),
    deleteColumn: (args: { projectId: string; columnId: string }) => fetchAPI<{ success: boolean }>("column/delete", args),
    // New projects service API
    getProjectsList: () => fetch("/api/projects/list", { method: "POST" }).then(r => r.json() as Promise<any[]>),
};

// Hook wrapper for use in React components
export function useTodosAPI() {
    return todosAPI;
}
