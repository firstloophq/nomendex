import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    addCardTags,
    addColumn,
    applyDocOperation,
    createCard,
    createClock,
    createDocManager,
    getBoardState,
    getCardDetail,
    moveCard,
    receive,
    removeCardTags,
    removeColumn,
    updateCardFields,
} from "@crdt/lib";
import type { CardApiResult, DocManager, LamportClock, RecordOp, UserInfo } from "@crdt/lib";
import { useCollab } from "@/contexts/CollabContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { todosAPI } from "@/hooks/useTodosAPI";
import { crdtDebugLog, summarizeOpsForDebug } from "@/lib/crdt-debug";
import {
    buildKanbanBoardDocId,
    buildKanbanCardDocId,
    getWorkspaceCollabScope,
    todoIdFromKanbanCardDocId,
} from "@/lib/collab-doc-id";
import type { Attachment } from "@/types/attachments";
import type { Todo } from "./todo-types";

type TodoStatus = Todo["status"];

interface KanbanState {
    manager: DocManager;
    clock: LamportClock;
}

interface PresenceSnapshot {
    viewingDocId?: string;
    user: UserInfo;
    editing: boolean;
}

interface CreateTodoInput {
    title: string;
    description?: string;
    project?: string;
    status?: TodoStatus;
    tags?: string[];
    dueDate?: string;
    attachments?: Attachment[];
}

interface UpdateTodoInput {
    todoId: string;
    updates: {
        title?: string;
        description?: string;
        status?: TodoStatus;
        project?: string;
        archived?: boolean;
        deleted?: boolean;
        tags?: string[];
        dueDate?: string;
        attachments?: Attachment[];
    };
}

interface ReorderInput {
    reorders: { todoId: string; order: number }[];
}

interface UseKanbanParams {
    project: string | null;
    enabled: boolean;
}

const DEFAULT_COLUMNS: ReadonlyArray<TodoStatus> = ["todo", "in_progress", "done", "later"];

function isTodoStatus(value: string | null | undefined): value is TodoStatus {
    return value === "todo" || value === "in_progress" || value === "done" || value === "later";
}

function boolToField(value: boolean): string {
    return value ? "true" : "false";
}

function fieldToBool(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
}

function fieldToOptional(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    return value === "" ? undefined : value;
}

function parseAttachments(raw: string | undefined): Attachment[] | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
            return parsed as Attachment[];
        }
    } catch {
        // Ignore malformed attachment payloads.
    }
    return undefined;
}

function normalizeProjectValue(params: {
    projectFromHook: string | null;
    projectFromInput?: string;
}): string {
    if (params.projectFromHook !== null) {
        return params.projectFromHook;
    }
    return params.projectFromInput ?? "";
}

function normalizeProjectForApi(value: string): string | undefined {
    if (value.trim() === "") return undefined;
    return value;
}

function filterTodosByProject(params: {
    todos: Todo[];
    project?: string;
}): Todo[] {
    if (params.project === undefined) {
        return params.todos;
    }
    if (params.project === "") {
        return params.todos.filter((todo) => !todo.project || todo.project.trim() === "");
    }
    return params.todos.filter((todo) => todo.project === params.project);
}

function extractRemoteClock(op: RecordOp): number | null {
    if ("id" in op && op.id && typeof op.id.clock === "number") {
        return op.id.clock;
    }
    return null;
}

function sortForBootstrap(a: Todo, b: Todo): number {
    const columnOrder = DEFAULT_COLUMNS;
    const aCol = columnOrder.indexOf(a.status);
    const bCol = columnOrder.indexOf(b.status);
    if (aCol !== bCol) {
        return aCol - bCol;
    }

    const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
        return aOrder - bOrder;
    }

    return a.title.localeCompare(b.title);
}

function deriveTodo(params: {
    manager: DocManager;
    boardDocId: string;
    cardId: string;
    order: number;
    projectFromHook: string | null;
}): Todo | null {
    const detail = getCardDetail({
        manager: params.manager,
        cardId: params.cardId,
        boardDocId: params.boardDocId,
    });
    if (!detail) return null;

    const statusFromColumn = detail.position?.column;
    const statusFromField = detail.fields.status;
    const resolvedStatus = isTodoStatus(statusFromColumn)
        ? statusFromColumn
        : (isTodoStatus(statusFromField) ? statusFromField : "todo");

    const createdAt = fieldToOptional(detail.fields.createdAt) ?? new Date(0).toISOString();
    const updatedAt = fieldToOptional(detail.fields.updatedAt) ?? createdAt;
    const explicitProject = fieldToOptional(detail.fields.project);
    const project = explicitProject ?? (params.projectFromHook === null ? undefined : params.projectFromHook);
    const tags = detail.tags.length > 0 ? [...detail.tags] : undefined;
    const attachments = parseAttachments(detail.fields.attachments);
    const todoId = fieldToOptional(detail.fields.todoId) ?? todoIdFromKanbanCardDocId({ docId: params.cardId });

    return {
        id: todoId,
        title: detail.fields.title ?? "",
        description: fieldToOptional(detail.fields.description),
        status: resolvedStatus,
        createdAt,
        updatedAt,
        archived: fieldToBool(detail.fields.archived),
        deleted: fieldToBool(detail.fields.deleted),
        project,
        tags,
        dueDate: fieldToOptional(detail.fields.dueDate),
        attachments,
        order: params.order,
    };
}

function appendResult(params: {
    pendingOps: Array<{ docId: string; op: RecordOp }>;
    result: CardApiResult;
}): KanbanState {
    const nextState = params.result.state;
    if (params.result.ops && params.result.ops.length > 0) {
        params.pendingOps.push(...params.result.ops);
    }
    return nextState;
}

export function useKanban(params: UseKanbanParams) {
    const { project, enabled } = params;
    const collab = useCollab();
    const collabClientId = collab?.clientId;
    const collabIsConnected = collab?.isConnected ?? false;
    const collabUserInfo = collab?.userInfo;
    const collabSubscribeDoc = collab?.subscribeDoc;
    const collabSubscribeAwareness = collab?.subscribeAwareness;
    const collabSendOps = collab?.sendOps;
    const collabSendAwareness = collab?.sendAwareness;
    const { activeWorkspace } = useWorkspaceSwitcher();
    const collabScope = useMemo(
        () => getWorkspaceCollabScope({ activeWorkspace }),
        [activeWorkspace]
    );

    const boardDocId = useMemo(
        () => buildKanbanBoardDocId({ scope: collabScope, project }),
        [collabScope, project]
    );
    const collabEnabled = enabled
        && activeWorkspace?.teamMode === "team"
        && !!collabClientId
        && !!collabSubscribeDoc
        && !!collabSendOps;

    const [state, setState] = useState<KanbanState>(() => ({
        manager: createDocManager(),
        clock: createClock({ clientId: collabClientId ?? "kanban-local" }),
    }));
    const [isBoardSynced, setIsBoardSynced] = useState(false);
    const [presenceByDoc, setPresenceByDoc] = useState<ReadonlyMap<string, ReadonlyArray<UserInfo>>>(new Map());
    const [editingByDoc, setEditingByDoc] = useState<ReadonlyMap<string, ReadonlyArray<UserInfo>>>(new Map());

    const stateRef = useRef<KanbanState>(state);
    stateRef.current = state;

    const cardUnsubsRef = useRef<Map<string, () => void>>(new Map());
    const bootstrapAttemptedRef = useRef<string | null>(null);
    const remotePresenceRef = useRef<Map<string, PresenceSnapshot>>(new Map());
    const toCardDocId = useCallback((todoId: string) => {
        return buildKanbanCardDocId({
            scope: collabScope,
            todoId,
        });
    }, [collabScope]);

    const resolveCardDocId = useCallback((params: {
        todoId: string;
        state?: KanbanState;
    }): string => {
        const preferredCardDocId = toCardDocId(params.todoId);
        const currentState = params.state ?? stateRef.current;
        if (preferredCardDocId === params.todoId) {
            return preferredCardDocId;
        }

        const preferredDetail = getCardDetail({
            manager: currentState.manager,
            cardId: preferredCardDocId,
            boardDocId,
        });
        if (preferredDetail) {
            return preferredCardDocId;
        }

        const legacyDetail = getCardDetail({
            manager: currentState.manager,
            cardId: params.todoId,
            boardDocId,
        });
        if (legacyDetail) {
            return params.todoId;
        }

        return preferredCardDocId;
    }, [boardDocId, toCardDocId]);

    useEffect(() => {
        bootstrapAttemptedRef.current = null;
    }, [boardDocId]);

    const clearPresenceState = useCallback(() => {
        remotePresenceRef.current.clear();
        setPresenceByDoc(new Map());
        setEditingByDoc(new Map());
    }, []);

    const rebuildPresenceMaps = useCallback(() => {
        const nextPresence = new Map<string, UserInfo[]>();
        const nextEditing = new Map<string, UserInfo[]>();

        for (const [, snapshot] of remotePresenceRef.current) {
            const docId = snapshot.viewingDocId;
            if (!docId) continue;
            const todoId = todoIdFromKanbanCardDocId({ docId });

            const viewers = nextPresence.get(todoId) ?? [];
            viewers.push(snapshot.user);
            nextPresence.set(todoId, viewers);

            if (snapshot.editing) {
                const editors = nextEditing.get(todoId) ?? [];
                editors.push(snapshot.user);
                nextEditing.set(todoId, editors);
            }
        }

        setPresenceByDoc(nextPresence);
        setEditingByDoc(nextEditing);
    }, []);

    const applyAndBroadcast = useCallback((params: {
        nextState: KanbanState;
        pendingOps: ReadonlyArray<{ docId: string; op: RecordOp }>;
        reason: string;
    }) => {
        setState(params.nextState);
        if (!collabEnabled || !collabSendOps) return;
        if (params.pendingOps.length === 0) return;

        const byDoc = new Map<string, RecordOp[]>();
        for (const { docId, op } of params.pendingOps) {
            let list = byDoc.get(docId);
            if (!list) {
                list = [];
                byDoc.set(docId, list);
            }
            list.push(op);
        }

        for (const [docId, ops] of byDoc) {
            collabSendOps({ docId, ops });
        }

        crdtDebugLog({
            event: "kanban_local_ops_sent",
            data: {
                boardDocId,
                reason: params.reason,
                docCount: byDoc.size,
                opCount: params.pendingOps.length,
                ops: summarizeOpsForDebug(params.pendingOps.map((entry) => entry.op)),
            },
        });
    }, [boardDocId, collabEnabled, collabSendOps]);

    const handleIncomingOps = useCallback((incoming: {
        docId: string;
        ops: ReadonlyArray<RecordOp>;
    }) => {
        setState((previous) => {
            let manager = previous.manager;
            let clock = previous.clock;

            for (const op of incoming.ops) {
                manager = applyDocOperation({
                    manager,
                    docId: incoming.docId,
                    op,
                });
                const remoteClock = extractRemoteClock(op);
                if (remoteClock !== null) {
                    clock = receive({ clock, remoteCounter: remoteClock });
                }
            }

            return { manager, clock };
        });
    }, []);

    const ensureColumns = useCallback((columns: ReadonlyArray<string>) => {
        if (!collabEnabled) return;

        let nextState = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];
        const existing = getBoardState({
            manager: nextState.manager,
            boardDocId,
        }).columns;

        for (const column of columns) {
            if (existing.includes(column)) continue;
            const result = addColumn({
                state: nextState,
                column,
                boardDocId,
            });
            nextState = appendResult({ pendingOps, result });
        }

        if (pendingOps.length === 0) return;
        applyAndBroadcast({
            nextState,
            pendingOps,
            reason: "ensure_columns",
        });
    }, [applyAndBroadcast, boardDocId, collabEnabled]);

    useEffect(() => {
        if (!collabEnabled || !collabSubscribeDoc || !collabClientId) {
            return;
        }

        setState({
            manager: createDocManager(),
            clock: createClock({ clientId: collabClientId }),
        });
        setIsBoardSynced(false);

        const unsubscribeBoard = collabSubscribeDoc({
            docId: boardDocId,
            onOps: ({ docId, ops }) => {
                handleIncomingOps({ docId, ops });
            },
            onSyncComplete: () => {
                setIsBoardSynced(true);
                crdtDebugLog({
                    event: "kanban_board_sync_complete",
                    data: { boardDocId },
                });
            },
        });

        const cardUnsubs = cardUnsubsRef.current;

        return () => {
            unsubscribeBoard();
            for (const [, unsubscribeCard] of cardUnsubs) {
                unsubscribeCard();
            }
            cardUnsubs.clear();
        };
    }, [boardDocId, collabClientId, collabEnabled, collabSubscribeDoc, handleIncomingOps]);

    const board = useMemo(() => {
        return getBoardState({
            manager: state.manager,
            boardDocId,
        });
    }, [state.manager, boardDocId]);

    const cardIds = useMemo(() => {
        const ids = new Set<string>();
        for (const column of board.columns) {
            const cards = board.cardsByColumn[column] ?? [];
            for (const card of cards) {
                ids.add(card.cardId);
            }
        }
        return Array.from(ids);
    }, [board]);

    useEffect(() => {
        if (!collabEnabled || !collabSubscribeDoc) {
            return;
        }

        const wanted = new Set(cardIds);
        for (const cardId of cardIds) {
            if (cardUnsubsRef.current.has(cardId)) continue;
            const unsubscribe = collabSubscribeDoc({
                docId: cardId,
                onOps: ({ docId, ops }) => {
                    handleIncomingOps({ docId, ops });
                },
            });
            cardUnsubsRef.current.set(cardId, unsubscribe);
        }

        for (const [cardId, unsubscribe] of cardUnsubsRef.current) {
            if (wanted.has(cardId)) continue;
            unsubscribe();
            cardUnsubsRef.current.delete(cardId);
        }
    }, [cardIds, collabEnabled, collabSubscribeDoc, handleIncomingOps]);

    useEffect(() => {
        if (!collabEnabled || !collabSubscribeAwareness || !collabClientId) {
            clearPresenceState();
            return;
        }

        const unsubscribe = collabSubscribeAwareness({
            docId: boardDocId,
            onAwareness: ({ clientId: remoteClientId, state: awarenessState }) => {
                if (remoteClientId === collabClientId) return;

                remotePresenceRef.current.set(remoteClientId, {
                    viewingDocId: awarenessState.viewingDocId,
                    user: awarenessState.user,
                    editing: !!awarenessState.cursor,
                });
                rebuildPresenceMaps();
            },
        });

        return () => {
            unsubscribe();
            clearPresenceState();
        };
    }, [
        boardDocId,
        clearPresenceState,
        collabClientId,
        collabEnabled,
        collabSubscribeAwareness,
        rebuildPresenceMaps,
    ]);

    useEffect(() => {
        if (!collabEnabled) return;
        if (!isBoardSynced) return;
        ensureColumns(DEFAULT_COLUMNS);
    }, [collabEnabled, ensureColumns, isBoardSynced]);

    const bootstrapFromFiles = useCallback(async () => {
        if (!collabEnabled) return;
        if (!isBoardSynced) return;
        if (bootstrapAttemptedRef.current === boardDocId) return;

        bootstrapAttemptedRef.current = boardDocId;

        const projectArg = project ?? undefined;
        let fileTodos: Todo[] = [];
        try {
            const [active, archived] = await Promise.all([
                todosAPI.getTodos({ project: projectArg }),
                todosAPI.getArchivedTodos({ project: projectArg }),
            ]);
            fileTodos = [...active, ...archived];
        } catch (error) {
            crdtDebugLog({
                event: "kanban_bootstrap_failed",
                level: "warn",
                data: {
                    boardDocId,
                    reason: "file_load_failed",
                    error: error instanceof Error ? error.message : String(error),
                },
            });
            return;
        }

        if (fileTodos.length === 0) {
            return;
        }

        const sortedTodos = [...fileTodos].sort(sortForBootstrap);
        let nextState = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];

        const existingColumns = getBoardState({ manager: nextState.manager, boardDocId }).columns;
        const desiredColumns = Array.from(new Set<string>([
            ...DEFAULT_COLUMNS,
            ...sortedTodos.map((todo) => todo.status),
        ]));

        for (const column of desiredColumns) {
            if (existingColumns.includes(column)) continue;
            const result = addColumn({
                state: nextState,
                column,
                boardDocId,
            });
            nextState = appendResult({ pendingOps, result });
        }

        for (const todo of sortedTodos) {
            const cardDocId = resolveCardDocId({
                todoId: todo.id,
                state: nextState,
            });
            const existingCard = getCardDetail({
                manager: nextState.manager,
                cardId: cardDocId,
                boardDocId,
            });
            if (existingCard) continue;

            const result = createCard({
                state: nextState,
                cardId: cardDocId,
                fields: {
                    todoId: todo.id,
                    title: todo.title,
                    description: todo.description ?? "",
                    status: todo.status,
                    project: todo.project ?? "",
                    createdAt: todo.createdAt,
                    updatedAt: todo.updatedAt,
                    archived: boolToField(!!todo.archived),
                    deleted: boolToField(!!todo.deleted),
                    dueDate: todo.dueDate ?? "",
                    attachments: JSON.stringify(todo.attachments ?? []),
                },
                tags: todo.tags ?? [],
                column: todo.status,
                boardDocId,
            });
            nextState = appendResult({ pendingOps, result });
        }

        if (pendingOps.length > 0) {
            applyAndBroadcast({
                nextState,
                pendingOps,
                reason: "bootstrap_from_files",
            });
        }
    }, [applyAndBroadcast, boardDocId, collabEnabled, isBoardSynced, project, resolveCardDocId]);

    useEffect(() => {
        void bootstrapFromFiles();
    }, [bootstrapFromFiles]);

    const todos = useMemo(() => {
        const result: Todo[] = [];
        for (const column of board.columns) {
            const cards = board.cardsByColumn[column] ?? [];
            cards.forEach((card, index) => {
                const todo = deriveTodo({
                    manager: state.manager,
                    boardDocId,
                    cardId: card.cardId,
                    order: index + 1,
                    projectFromHook: project,
                });
                if (todo) {
                    result.push(todo);
                }
            });
        }
        return result;
    }, [board, boardDocId, project, state.manager]);

    const activeTodos = useMemo(() => {
        return todos.filter((todo) => !todo.archived && !todo.deleted);
    }, [todos]);

    const archivedTodos = useMemo(() => {
        return todos.filter((todo) => !!todo.archived && !todo.deleted);
    }, [todos]);

    const tags = useMemo(() => {
        const tagSet = new Set<string>();
        for (const todo of activeTodos) {
            for (const tag of todo.tags ?? []) {
                tagSet.add(tag);
            }
        }
        return Array.from(tagSet).sort();
    }, [activeTodos]);

    const projects = useMemo(() => {
        const projectSet = new Set<string>();
        for (const todo of activeTodos) {
            if (!todo.project || todo.project.trim() === "") continue;
            projectSet.add(todo.project);
        }
        return Array.from(projectSet).sort();
    }, [activeTodos]);

    const getTodoByIdFromState = useCallback((todoId: string, currentState: KanbanState): Todo | null => {
        const resolvedCardDocId = resolveCardDocId({
            todoId,
            state: currentState,
        });
        const currentBoard = getBoardState({
            manager: currentState.manager,
            boardDocId,
        });

        for (const column of currentBoard.columns) {
            const cards = currentBoard.cardsByColumn[column] ?? [];
            const index = cards.findIndex(
                (card) => card.cardId === resolvedCardDocId || card.cardId === todoId
            );
            if (index === -1) continue;
            const cardDocId = cards[index]?.cardId ?? resolvedCardDocId;
            return deriveTodo({
                manager: currentState.manager,
                boardDocId,
                cardId: cardDocId,
                order: index + 1,
                projectFromHook: project,
            });
        }
        return null;
    }, [boardDocId, project, resolveCardDocId]);

    const getTodos = useCallback(async (args: { project?: string } = {}) => {
        return filterTodosByProject({ todos: activeTodos, project: args.project });
    }, [activeTodos]);

    const getArchived = useCallback(async (args: { project?: string } = {}) => {
        return filterTodosByProject({ todos: archivedTodos, project: args.project });
    }, [archivedTodos]);

    const getTags = useCallback(async () => {
        return tags;
    }, [tags]);

    const getProjects = useCallback(async () => {
        return projects;
    }, [projects]);

    const sendPresence = useCallback((params: {
        todoId: string | null;
        editing?: boolean;
    }) => {
        if (!collabEnabled || !collabSendAwareness || !collabUserInfo) return;

        const viewingDocId = params.todoId
            ? resolveCardDocId({ todoId: params.todoId })
            : undefined;

        collabSendAwareness({
            docId: boardDocId,
            state: {
                viewingDocId,
                user: collabUserInfo,
                lastUpdated: Date.now(),
                cursor: params.editing ? { anchor: 0, head: 0 } : undefined,
            },
        });
    }, [boardDocId, collabEnabled, collabSendAwareness, collabUserInfo, resolveCardDocId]);

    const createTodoItem = useCallback(async (input: CreateTodoInput): Promise<Todo> => {
        if (!collabEnabled) {
            throw new Error("Kanban CRDT is not enabled");
        }

        const status = input.status ?? "todo";
        const resolvedProject = normalizeProjectValue({
            projectFromHook: project,
            projectFromInput: input.project,
        });

        const persisted = await todosAPI.createTodo({
            title: input.title,
            description: input.description,
            project: normalizeProjectForApi(resolvedProject),
            status,
            tags: input.tags,
            dueDate: input.dueDate,
            attachments: input.attachments,
        });

        let nextState = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];

        const existingColumns = getBoardState({
            manager: nextState.manager,
            boardDocId,
        }).columns;
        if (!existingColumns.includes(status)) {
            const ensureStatus = addColumn({
                state: nextState,
                column: status,
                boardDocId,
            });
            nextState = appendResult({ pendingOps, result: ensureStatus });
        }

        const result = createCard({
            state: nextState,
            cardId: toCardDocId(persisted.id),
            fields: {
                todoId: persisted.id,
                title: persisted.title,
                description: persisted.description ?? "",
                status: persisted.status,
                project: persisted.project ?? resolvedProject,
                createdAt: persisted.createdAt,
                updatedAt: persisted.updatedAt,
                archived: boolToField(!!persisted.archived),
                deleted: boolToField(false),
                dueDate: persisted.dueDate ?? "",
                attachments: JSON.stringify(persisted.attachments ?? []),
            },
            tags: persisted.tags ?? [],
            column: persisted.status,
            boardDocId,
        });
        nextState = appendResult({ pendingOps, result });

        applyAndBroadcast({
            nextState,
            pendingOps,
            reason: "create_todo",
        });

        const created = getTodoByIdFromState(persisted.id, nextState);
        if (!created) {
            throw new Error("Failed to create todo");
        }
        return created;
    }, [applyAndBroadcast, boardDocId, collabEnabled, getTodoByIdFromState, project, toCardDocId]);

    const updateTodoItem = useCallback(async (input: UpdateTodoInput): Promise<Todo> => {
        if (!collabEnabled) {
            throw new Error("Kanban CRDT is not enabled");
        }

        let nextState = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];
        const cardDocId = resolveCardDocId({
            todoId: input.todoId,
            state: nextState,
        });

        const detail = getCardDetail({
            manager: nextState.manager,
            cardId: cardDocId,
            boardDocId,
        });
        if (!detail) {
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        const updatesForFile: UpdateTodoInput["updates"] = {
            ...input.updates,
        };
        if (input.updates.deleted === true && updatesForFile.archived === undefined) {
            updatesForFile.archived = true;
        }
        if (input.updates.deleted === false && updatesForFile.archived === undefined) {
            updatesForFile.archived = false;
        }

        let persistedTodo: Todo;
        if (Object.keys(updatesForFile).length > 0) {
            persistedTodo = await todosAPI.updateTodo({
                todoId: input.todoId,
                updates: updatesForFile,
            });
        } else {
            persistedTodo = await todosAPI.getTodoById({ todoId: input.todoId });
        }

        const nextDeleted = input.updates.deleted ?? fieldToBool(detail.fields.deleted);
        const currentStatus = isTodoStatus(detail.position?.column)
            ? detail.position!.column
            : (isTodoStatus(detail.fields.status) ? detail.fields.status : "todo");
        const targetStatus = persistedTodo.status;

        const fieldResult = updateCardFields({
            state: nextState,
            cardId: cardDocId,
            fields: {
                todoId: input.todoId,
                title: persistedTodo.title,
                description: persistedTodo.description ?? "",
                status: targetStatus,
                project: persistedTodo.project ?? "",
                createdAt: persistedTodo.createdAt,
                updatedAt: persistedTodo.updatedAt,
                archived: boolToField(!!persistedTodo.archived),
                deleted: boolToField(nextDeleted),
                dueDate: persistedTodo.dueDate ?? "",
                attachments: JSON.stringify(persistedTodo.attachments ?? []),
            },
        });
        nextState = appendResult({ pendingOps, result: fieldResult });

        if (input.updates.tags !== undefined) {
            const currentTags = new Set(detail.tags);
            const nextTags = new Set(persistedTodo.tags ?? []);
            const toAdd = [...nextTags].filter((tag) => !currentTags.has(tag));
            const toRemove = detail.tags.filter((tag) => !nextTags.has(tag));

            if (toAdd.length > 0) {
                const addResult = addCardTags({
                    state: nextState,
                    cardId: cardDocId,
                    tags: toAdd,
                });
                nextState = appendResult({ pendingOps, result: addResult });
            }

            if (toRemove.length > 0) {
                const removeResult = removeCardTags({
                    state: nextState,
                    cardId: cardDocId,
                    tags: toRemove,
                });
                nextState = appendResult({ pendingOps, result: removeResult });
            }
        }

        if (targetStatus !== currentStatus) {
            const columns = getBoardState({
                manager: nextState.manager,
                boardDocId,
            }).columns;
            if (!columns.includes(targetStatus)) {
                const ensureStatus = addColumn({
                    state: nextState,
                    column: targetStatus,
                    boardDocId,
                });
                nextState = appendResult({ pendingOps, result: ensureStatus });
            }

            const moveResult = moveCard({
                state: nextState,
                cardId: cardDocId,
                column: targetStatus,
                boardDocId,
            });
            nextState = appendResult({ pendingOps, result: moveResult });
        }

        applyAndBroadcast({
            nextState,
            pendingOps,
            reason: "update_todo",
        });

        const updated = getTodoByIdFromState(input.todoId, nextState);
        if (!updated) {
            throw new Error(`Todo with ID ${input.todoId} not found after update`);
        }
        return updated;
    }, [applyAndBroadcast, boardDocId, collabEnabled, getTodoByIdFromState, resolveCardDocId]);

    const deleteTodoItem = useCallback(async (input: { todoId: string }) => {
        await updateTodoItem({
            todoId: input.todoId,
            updates: {
                archived: true,
                deleted: true,
            },
        });
        return { success: true };
    }, [updateTodoItem]);

    const archiveTodoItem = useCallback(async (input: { todoId: string }) => {
        return updateTodoItem({
            todoId: input.todoId,
            updates: {
                archived: true,
            },
        });
    }, [updateTodoItem]);

    const unarchiveTodoItem = useCallback(async (input: { todoId: string }) => {
        return updateTodoItem({
            todoId: input.todoId,
            updates: {
                archived: false,
                deleted: false,
            },
        });
    }, [updateTodoItem]);

    const reorderTodoItems = useCallback(async (input: ReorderInput) => {
        if (!collabEnabled) {
            throw new Error("Kanban CRDT is not enabled");
        }
        if (input.reorders.length === 0) {
            return { success: true };
        }

        await todosAPI.reorderTodos({ reorders: input.reorders });

        const orderedIds = [...input.reorders]
            .sort((a, b) => a.order - b.order)
            .map((entry) => entry.todoId);
        const first = orderedIds[0];
        if (!first) {
            return { success: true };
        }

        let nextState = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];
        const firstTodo = getTodoByIdFromState(first, nextState);
        if (!firstTodo) {
            return { success: true };
        }

        for (let index = 0; index < orderedIds.length; index++) {
            const todoId = orderedIds[index];
            if (!todoId) continue;
            const cardDocId = resolveCardDocId({ todoId, state: nextState });
            const afterTodoId = index > 0 ? orderedIds[index - 1] : undefined;
            const afterCardId = afterTodoId
                ? resolveCardDocId({ todoId: afterTodoId, state: nextState })
                : undefined;
            const moveResult = moveCard({
                state: nextState,
                cardId: cardDocId,
                column: firstTodo.status,
                afterCardId,
                boardDocId,
            });
            nextState = appendResult({ pendingOps, result: moveResult });
        }

        applyAndBroadcast({
            nextState,
            pendingOps,
            reason: "reorder_todos",
        });

        return { success: true };
    }, [applyAndBroadcast, boardDocId, collabEnabled, getTodoByIdFromState, resolveCardDocId]);

    const getTodoById = useCallback(async (input: { todoId: string }): Promise<Todo> => {
        const todo = todos.find((candidate) => candidate.id === input.todoId);
        if (!todo) {
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }
        return todo;
    }, [todos]);

    const addBoardColumn = useCallback(async (input: { name: string }) => {
        ensureColumns([input.name]);
    }, [ensureColumns]);

    const removeBoardColumnByName = useCallback(async (input: { name: string }) => {
        if (!collabEnabled) {
            throw new Error("Kanban CRDT is not enabled");
        }

        let nextState = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];
        const result = removeColumn({
            state: nextState,
            column: input.name,
            boardDocId,
        });
        nextState = appendResult({ pendingOps, result });
        applyAndBroadcast({
            nextState,
            pendingOps,
            reason: "remove_column",
        });
    }, [applyAndBroadcast, boardDocId, collabEnabled]);

    return useMemo(() => ({
        isConnected: collabIsConnected,
        boardDocId,
        columns: board.columns,
        activeTodos,
        archivedTodos,
        tags,
        projects,
        presenceByDoc,
        editingByDoc,
        sendPresence,
        getTodos,
        getArchivedTodos: getArchived,
        getTags,
        getProjects,
        getTodoById,
        createTodo: createTodoItem,
        updateTodo: updateTodoItem,
        deleteTodo: deleteTodoItem,
        archiveTodo: archiveTodoItem,
        unarchiveTodo: unarchiveTodoItem,
        reorderTodos: reorderTodoItems,
        addColumn: addBoardColumn,
        removeColumn: removeBoardColumnByName,
    }), [
        collabIsConnected,
        boardDocId,
        board.columns,
        activeTodos,
        archivedTodos,
        tags,
        projects,
        presenceByDoc,
        editingByDoc,
        sendPresence,
        getTodos,
        getArchived,
        getTags,
        getProjects,
        getTodoById,
        createTodoItem,
        updateTodoItem,
        deleteTodoItem,
        archiveTodoItem,
        unarchiveTodoItem,
        reorderTodoItems,
        addBoardColumn,
        removeBoardColumnByName,
    ]);
}
