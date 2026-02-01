import { TypedPluginWithFunctions } from "@/types/Plugin";
import { functionStubs, TodosPluginBase } from "./index";
import { FunctionsFromStubs } from "@/types/Functions";
import { createServiceLogger } from "@/lib/logger";
import { Todo } from "./todo-types";
import { FileDatabase } from "@/storage/FileDatabase";
import path from "path";
import { getTodosPath, hasActiveWorkspace } from "@/storage/root-path";
import type { Attachment } from "@/types/attachments";
import { BoardConfig } from "./board-types";

// Create logger for todos plugin
const todosLogger = createServiceLogger("TODOS");

// Lazy-initialized FileDatabase for todos
let todosDb: FileDatabase<Todo> | null = null;
// Lazy-initialized FileDatabase for board configs
let boardConfigDb: FileDatabase<BoardConfig> | null = null;

function getBoardConfigPath(): string {
    return path.join(getTodosPath(), "..", "board-configs");
}

/**
 * Initialize the todos service. Must be called after initializePaths().
 */
export async function initializeTodosService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        todosLogger.warn("No active workspace, skipping todos initialization");
        return;
    }
    todosDb = new FileDatabase<Todo>(getTodosPath());
    await todosDb.initialize();

    // NEW: Initialize board config database
    boardConfigDb = new FileDatabase<BoardConfig>(getBoardConfigPath());
    await boardConfigDb.initialize();
    todosLogger.info("Todos service initialized");
}

function getDb(): FileDatabase<Todo> {
    if (!todosDb) {
        throw new Error("Todos service not initialized. Call initializeTodosService() first.");
    }
    return todosDb;
}

async function getTodos(input: { project?: string }) {
    todosLogger.info(`Getting todos${input.project !== undefined ? ` for project: ${input.project || 'No Project'}` : ''}`);

    try {
        const todos = await getDb().findAll();

        let activeTodos = todos.filter(t => !t.archived);

        // Filter by project if specified
        if (input.project !== undefined) {
            if (input.project === "") {
                // Empty string means "no project" - filter for todos without a project (exclude items with any project)
                activeTodos = activeTodos.filter(t => !t.project || t.project.trim() === "");
            } else {
                // Filter for specific project
                activeTodos = activeTodos.filter(t => t.project === input.project);
            }
        }

        // Sort todos by order (nulls last)
        activeTodos.sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });

        todosLogger.info(`Retrieved ${activeTodos.length} todos`);
        return activeTodos;
    } catch (error) {
        todosLogger.error(`Failed to get todos`, { error });
        throw error;
    }
}

async function getTodoById(input: { todoId: string }) {
    todosLogger.info(`Getting todo by ID: ${input.todoId}`);

    try {
        const todo = await getDb().findById(input.todoId);

        if (!todo) {
            todosLogger.warn(`Todo not found: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Retrieved todo: ${input.todoId}`);
        return todo;
    } catch (error) {
        todosLogger.error(`Failed to get todo ${input.todoId}`, { error });
        throw error;
    }
}

async function createTodo(input: {
    title: string;
    description?: string;
    project?: string;
    status?: "todo" | "in_progress" | "done" | "later";
    tags?: string[];
    dueDate?: string;
    attachments?: Attachment[];
}) {
    todosLogger.info(`Creating new todo: ${input.title}`);

    try {
        // Get existing todos to determine next order
        const existingTodos = await getDb().findAll();
        const status = input.status || "todo";

        // Find max order for this status
        const todosInStatus = existingTodos.filter(t => t.status === status && !t.archived);
        const maxOrder = todosInStatus.reduce((max, todo) => {
            return Math.max(max, todo.order || 0);
        }, 0);

        const now = new Date().toISOString();
        const newTodo: Todo = {
            id: `todo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: input.title,
            description: input.description,
            status: status,
            createdAt: now,
            updatedAt: now,
            archived: false,
            project: input.project,
            order: maxOrder + 1,
            tags: input.tags,
            dueDate: input.dueDate,
            attachments: input.attachments,
        };

        const created = await getDb().create(newTodo);

        todosLogger.info(`Created todo: ${created.id} with order ${created.order}`);
        return created;
    } catch (error) {
        todosLogger.error(`Failed to create todo`, { error });
        throw error;
    }
}

async function updateTodo(input: {
    todoId: string;
    updates: {
        title?: string;
        description?: string;
        status?: "todo" | "in_progress" | "done" | "later";
        project?: string;
        archived?: boolean;
        order?: number;
        tags?: string[];
        dueDate?: string;
        attachments?: Attachment[];
        customColumnId?: string;
    };
}) {
    todosLogger.info(`Updating todo: ${input.todoId}`);

    try {
        let updates = {
            ...input.updates,
            updatedAt: new Date().toISOString(),
        };

        // If status is changing, assign new order for the target status
        if (input.updates.status) {
            const currentTodo = await getDb().findById(input.todoId);
            if (currentTodo && currentTodo.status !== input.updates.status) {
                // Get existing todos to determine next order for new status
                const existingTodos = await getDb().findAll();
                const todosInNewStatus = existingTodos.filter(t =>
                    t.status === input.updates.status && !t.archived && t.id !== input.todoId
                );
                const maxOrder = todosInNewStatus.reduce((max, todo) => {
                    return Math.max(max, todo.order || 0);
                }, 0);

                updates.order = maxOrder + 1;
                todosLogger.info(`Status changed, assigning new order: ${updates.order}`);
            }
        }

        const updated = await getDb().update(input.todoId, updates);

        if (!updated) {
            todosLogger.warn(`Todo not found for update: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Updated todo: ${input.todoId}`);
        return updated;
    } catch (error) {
        todosLogger.error(`Failed to update todo ${input.todoId}`, { error });
        throw error;
    }
}

async function deleteTodo(input: { todoId: string }) {
    todosLogger.info(`Deleting todo: ${input.todoId}`);

    try {
        const deleted = await getDb().delete(input.todoId);

        if (!deleted) {
            todosLogger.warn(`Todo not found for deletion: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Deleted todo: ${input.todoId}`);
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to delete todo ${input.todoId}`, { error });
        throw error;
    }
}

async function getProjects() {
    todosLogger.info(`Getting unique projects`);

    try {
        const todos = await getDb().findAll();
        const activeTodos = todos.filter(t => !t.archived);

        // Extract unique projects
        const projectSet = new Set<string>();
        for (const todo of activeTodos) {
            if (todo.project) {
                projectSet.add(todo.project);
            }
        }

        const projects = Array.from(projectSet).sort();
        todosLogger.info(`Found ${projects.length} unique projects`);
        return projects;
    } catch (error) {
        todosLogger.error(`Failed to get projects`, { error });
        throw error;
    }
}

async function reorderTodos(input: {
    reorders: { todoId: string; order: number }[];
}) {
    todosLogger.info(`Reordering ${input.reorders.length} todos`);

    try {
        // Update each todo with its new order
        for (const reorder of input.reorders) {
            await getDb().update(reorder.todoId, {
                order: reorder.order,
                updatedAt: new Date().toISOString(),
            });
        }

        todosLogger.info(`Successfully reordered todos`);
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to reorder todos`, { error });
        throw error;
    }
}

async function archiveTodo(input: { todoId: string }) {
    todosLogger.info(`Archiving todo: ${input.todoId}`);

    try {
        const updated = await getDb().update(input.todoId, {
            archived: true,
            updatedAt: new Date().toISOString(),
        });

        if (!updated) {
            todosLogger.warn(`Todo not found for archiving: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Archived todo: ${input.todoId}`);
        return updated;
    } catch (error) {
        todosLogger.error(`Failed to archive todo ${input.todoId}`, { error });
        throw error;
    }
}

async function unarchiveTodo(input: { todoId: string }) {
    todosLogger.info(`Unarchiving todo: ${input.todoId}`);

    try {
        const updated = await getDb().update(input.todoId, {
            archived: false,
            updatedAt: new Date().toISOString(),
        });

        if (!updated) {
            todosLogger.warn(`Todo not found for unarchiving: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Unarchived todo: ${input.todoId}`);
        return updated;
    } catch (error) {
        todosLogger.error(`Failed to unarchive todo ${input.todoId}`, { error });
        throw error;
    }
}

async function getArchivedTodos(input: { project?: string }) {
    todosLogger.info(`Getting archived todos${input.project !== undefined ? ` for project: ${input.project || 'No Project'}` : ''}`);

    try {
        const todos = await getDb().findAll();
        console.log("All todos found:", todos.length);

        let archivedTodos = todos.filter(t => t.archived);
        console.log("Archived todos before project filter:", archivedTodos.length, archivedTodos.map(t => ({ id: t.id, title: t.title, project: t.project, archived: t.archived })));

        // Filter by project if specified
        if (input.project !== undefined) {
            console.log("Filtering by project:", input.project);
            if (input.project === "") {
                // Empty string means "no project" - filter for todos without a project
                archivedTodos = archivedTodos.filter(t => !t.project || t.project.trim() === "");
            } else {
                // Filter for specific project
                archivedTodos = archivedTodos.filter(t => t.project === input.project);
            }
            console.log("Archived todos after project filter:", archivedTodos.length);
        }

        // Sort todos by order (nulls last)
        archivedTodos.sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });

        todosLogger.info(`Retrieved ${archivedTodos.length} archived todos`);
        console.log("Final archived todos:", archivedTodos);
        return archivedTodos;
    } catch (error) {
        todosLogger.error(`Failed to get archived todos`, { error });
        throw error;
    }
}

async function getTags() {
    todosLogger.info(`Getting unique tags`);

    try {
        const todos = await getDb().findAll();
        const activeTodos = todos.filter(t => !t.archived);

        // Extract unique tags
        const tagSet = new Set<string>();
        for (const todo of activeTodos) {
            if (todo.tags) {
                for (const tag of todo.tags) {
                    tagSet.add(tag);
                }
            }
        }

        const tags = Array.from(tagSet).sort();
        todosLogger.info(`Found ${tags.length} unique tags`);
        return tags;
    } catch (error) {
        todosLogger.error(`Failed to get tags`, { error });
        throw error;
    }
}

function getBoardConfigDb(): FileDatabase<BoardConfig> {
    if (!boardConfigDb) {
        throw new Error("Board config service not initialized.");
    }
    return boardConfigDb;
}

/**
 * Get board config for a project. Returns null if not found.
 */
async function getBoardConfig(input: { projectId: string }): Promise<BoardConfig | null> {
    todosLogger.info(`Getting board config for project: ${input.projectId || "(no project)"}`);

    try {
        const configs = await getBoardConfigDb().findAll();
        const config = configs.find(c => c.projectId === input.projectId);
        return config || null;
    } catch (error) {
        todosLogger.error(`Failed to get board config`, { error });
        throw error;
    }
}

/**
 * Save board config (create new or update existing).
 */
async function saveBoardConfig(input: { config: BoardConfig }): Promise<BoardConfig> {
    todosLogger.info(`Saving board config for project: ${input.config.projectId || "(no project)"}`);

    try {
        const existing = await getBoardConfig({ projectId: input.config.projectId });

        if (existing) {
            // Update existing
            const updated = await getBoardConfigDb().update(existing.id, input.config);
            if (!updated) throw new Error("Failed to update board config");
            return updated;
        } else {
            // Create new
            const created = await getBoardConfigDb().create(input.config);
            return created;
        }
    } catch (error) {
        todosLogger.error(`Failed to save board config`, { error });
        throw error;
    }
}

/**
 * Delete a column and migrate its todos to the first remaining column.
 */
async function deleteColumn(input: { projectId: string; columnId: string }): Promise<{ success: boolean }> {
    todosLogger.info(`Deleting column ${input.columnId} from project ${input.projectId}`);

    try {
        const config = await getBoardConfig({ projectId: input.projectId });
        if (!config) throw new Error("Board config not found");

        // Find fallback column
        const sortedColumns = [...config.columns].sort((a, b) => a.order - b.order);
        const fallbackColumn = sortedColumns.find(c => c.id !== input.columnId);
        if (!fallbackColumn) throw new Error("Cannot delete the only column");

        // Migrate todos from deleted column
        const todos = await getDb().findAll();
        const orphanTodos = todos.filter(t => {
            const todoProject = t.project || "";
            return todoProject === input.projectId && t.customColumnId === input.columnId;
        });

        for (const todo of orphanTodos) {
            await getDb().update(todo.id, {
                customColumnId: fallbackColumn.id,
                updatedAt: new Date().toISOString()
            });
        }

        // Remove column from config
        const newColumns = config.columns.filter(c => c.id !== input.columnId);
        await saveBoardConfig({
            config: { ...config, columns: newColumns }
        });

        todosLogger.info(`Deleted column, moved ${orphanTodos.length} todos to ${fallbackColumn.title}`);
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to delete column`, { error });
        throw error;
    }
}


const functions: FunctionsFromStubs<typeof functionStubs> = {
    getTodos: { ...functionStubs.getTodos, fx: getTodos },
    getTodoById: { ...functionStubs.getTodoById, fx: getTodoById },
    createTodo: { ...functionStubs.createTodo, fx: createTodo },
    updateTodo: { ...functionStubs.updateTodo, fx: updateTodo },
    deleteTodo: { ...functionStubs.deleteTodo, fx: deleteTodo },
    getProjects: { ...functionStubs.getProjects, fx: getProjects },
    reorderTodos: { ...functionStubs.reorderTodos, fx: reorderTodos },
    archiveTodo: { ...functionStubs.archiveTodo, fx: archiveTodo },
    unarchiveTodo: { ...functionStubs.unarchiveTodo, fx: unarchiveTodo },
    getArchivedTodos: { ...functionStubs.getArchivedTodos, fx: getArchivedTodos },
    getTags: { ...functionStubs.getTags, fx: getTags },
    getBoardConfig: { ...functionStubs.getBoardConfig, fx: getBoardConfig },
    saveBoardConfig: { ...functionStubs.saveBoardConfig, fx: saveBoardConfig },
    deleteColumn: { ...functionStubs.deleteColumn, fx: deleteColumn },
};

// MCP Server configuration (backend only)
const mcpServers = {
    todos: {
        name: "todos-mcp-server",
        version: "1.0.0",
        cmd: "bun",
        args: [path.resolve(__dirname, "./TodoMCPServer.ts")],
    }
};

const TodosPlugin: TypedPluginWithFunctions<typeof functionStubs> = {
    ...TodosPluginBase,
    mcpServers,
    functions,
};

export default TodosPlugin;
export const TodosPluginWithFunctions = TodosPlugin;

// Export individual functions for MCP
export {
    getTodos, createTodo, updateTodo, deleteTodo, getTodoById,
    getProjects, reorderTodos, archiveTodo, unarchiveTodo, getArchivedTodos, getTags,
    getBoardConfig, saveBoardConfig, deleteColumn
};