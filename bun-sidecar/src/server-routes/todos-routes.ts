// Direct API routes for todos feature
// These replace the generic /api/plugin-registry endpoint

import {
    getTodos,
    getTodoById,
    createTodo,
    updateTodo,
    deleteTodo,
    getProjects,
    reorderTodos,
    archiveTodo,
    unarchiveTodo,
    getArchivedTodos,
    getTags,
    getBoardConfig,
    saveBoardConfig,
    deleteColumn,
} from "@/features/todos/fx";

export const todosRoutes = {
    "/api/todos/list": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getTodos(args);
            return Response.json(result);
        },
    },
    "/api/todos/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getTodoById(args);
            return Response.json(result);
        },
    },
    "/api/todos/create": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await createTodo(args);
            return Response.json(result);
        },
    },
    "/api/todos/update": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await updateTodo(args);
            return Response.json(result);
        },
    },
    "/api/todos/delete": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await deleteTodo(args);
            return Response.json(result);
        },
    },
    "/api/todos/projects": {
        async POST() {
            const result = await getProjects();
            return Response.json(result);
        },
    },
    "/api/todos/reorder": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await reorderTodos(args);
            return Response.json(result);
        },
    },
    "/api/todos/archive": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await archiveTodo(args);
            return Response.json(result);
        },
    },
    "/api/todos/unarchive": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await unarchiveTodo(args);
            return Response.json(result);
        },
    },
    "/api/todos/archived": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getArchivedTodos(args);
            return Response.json(result);
        },
    },
    "/api/todos/tags": {
        async POST() {
            const result = await getTags();
            return Response.json(result);
        },
    },
    "/api/todos/board-config/get": {
        async POST(req: Request) {
            const args = await req.json();
            return Response.json(await getBoardConfig(args));
        },
    },
    "/api/todos/board-config/save": {
        async POST(req: Request) {
            const args = await req.json();
            return Response.json(await saveBoardConfig(args));
        },
    },
    "/api/todos/column/delete": {
        async POST(req: Request) {
            const args = await req.json();
            return Response.json(await deleteColumn(args));
        },
    },
};
