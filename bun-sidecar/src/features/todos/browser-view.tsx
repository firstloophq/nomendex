import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useTheme } from "@/hooks/useTheme";
import { subscribe } from "@/lib/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, CheckCircle2, Clock, Calendar, Eye, EyeOff, MoreHorizontal, Archive, Search, Plus, Settings, Circle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { TodoCard } from "./TodoCard";
import { CreateTodoDialog } from "./CreateTodoDialog";
import { TaskCardEditor } from "./TaskCardEditor";
import { TagFilter } from "./TagFilter";
import { Todo } from "./todo-types";
import { BoardConfig, BoardColumn, getDefaultColumns } from "@/features/projects/project-types";
import { BoardSettingsDialog } from "./BoardSettingsDialog";
import type { Attachment } from "@/types/attachments";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import {
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    useDndContext,
} from "@dnd-kit/core";
import {
    SortableContext,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import {
    useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

export function TodosBrowserView({ project, selectedTodoId: initialSelectedTodoId }: { project?: string | null; selectedTodoId?: string | null } = {}) {
    // Support both 'project' and 'filterProject' prop names for backward compatibility
    const filterProject = project;
    const { loading, setLoading } = usePlugin();
    const { activeTab, setTabName, openTab, getProjectPreferences, setProjectPreferences } = useWorkspaceContext();
    const { currentTheme } = useTheme();

    const todosAPI = useTodosAPI();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const hasSetTabNameRef = useRef<boolean>(false);

    // Derive the project key for preferences storage
    // - If filterProject is a non-empty string, use it as the key
    // - If filterProject is null or undefined (all projects view), use "__all__"
    // - If filterProject is "" (no project), use "__none__"
    const projectPreferencesKey = filterProject === null || filterProject === undefined ? "__all__" : filterProject === "" ? "__none__" : filterProject;
    const projectPrefs = getProjectPreferences(projectPreferencesKey);
    const showLaterColumn = !projectPrefs.hideLaterColumn;
    const [newTodo, setNewTodo] = useState<{
        title: string;
        description: string;
        project: string;
        status: "todo" | "in_progress" | "done" | "later";
        tags: string[];
        dueDate?: string;
        attachments?: Attachment[];
        customColumnId?: string; // Add support for creating in specific column
    }>({
        title: "",
        description: "",
        project: filterProject && filterProject !== "" ? filterProject : "",
        status: "todo",
        tags: [],
        dueDate: undefined,
        attachments: undefined,
        customColumnId: undefined,
    });

    const [boardConfig, setBoardConfig] = useState<BoardConfig | null>(null);
    const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);

    // Search and keyboard navigation state
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTodoId, setSelectedTodoId] = useState<string | null>(initialSelectedTodoId ?? null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Helper to open create dialog with specific status OR column
    const openCreateDialogWithStatus = useCallback((status: "todo" | "in_progress" | "done" | "later", columnId?: string) => {
        setNewTodo(prev => ({ ...prev, status, customColumnId: columnId }));
        setCreateDialogOpen(true);
    }, []);

    // Drag and drop state
    const [draggedTodo, setDraggedTodo] = useState<Todo | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    useEffect(() => {
        console.log("Current todos:", { todos });
    }, [todos]);

    // Close all dialogs when tabs are being closed
    useEffect(() => {
        return subscribe("workspace:closeAllTabs", () => {
            setCreateDialogOpen(false);
            setEditDialogOpen(false);
        });
    }, []);

    // Toggle show/hide later column - persists to workspace.json
    const toggleShowLaterColumn = useCallback(() => {
        setProjectPreferences(projectPreferencesKey, { hideLaterColumn: !projectPrefs.hideLaterColumn });
    }, [setProjectPreferences, projectPreferencesKey, projectPrefs.hideLaterColumn]);


    // Update the tab name based on the project - only once when component mounts
    useEffect(() => {
        if (activeTab && activeTab.pluginInstance.plugin.id === "todos" && !hasSetTabNameRef.current) {
            let tabName = "Todos";
            if (filterProject && filterProject !== "") {
                tabName = `Todos: ${filterProject}`;
            } else if (filterProject === "") {
                tabName = "Todos: No Project";
            }

            setTabName(activeTab.id, tabName);
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, filterProject, setTabName]); // Dependencies are fine since we check hasSetTabNameRef

    // Update the project field when filterProject changes
    useEffect(() => {
        // filterProject can be null, undefined, or an empty string (for "No Project")
        // Only set the project if filterProject is a non-empty string
        const projectValue = filterProject && filterProject !== "" ? filterProject : "";
        setNewTodo(prev => ({
            ...prev,
            project: projectValue
        }));
    }, [filterProject]);

    // Load Board Config
    useEffect(() => {
        async function loadBoardConfig() {
            if (filterProject === null || filterProject === undefined || filterProject === "") {
                setBoardConfig(null);
                return;
            }

            try {
                const config = await todosAPI.getBoardConfig({
                    projectName: filterProject
                });
                setBoardConfig(config);
            } catch (error) {
                console.error("Failed to load board config:", error);
            }
        }
        loadBoardConfig();
    }, [filterProject, todosAPI]);

    // Helper: Determine which column a todo belongs to
    // IMPORTANT: This must be defined before handleDragEnd which uses it
    const getColumnForTodo = useCallback((todo: Todo): string => {
        // If board config exists, check for customColumnId
        if (boardConfig) {
            if (todo.customColumnId) {
                const exists = boardConfig.columns.find(c => c.id === todo.customColumnId);
                if (exists) return todo.customColumnId;
            }
            // Fallback for custom mode logic
            if (todo.status === "done") {
                // Put in last column
                return boardConfig.columns[boardConfig.columns.length - 1].id;
            }
            // Put in first column
            return boardConfig.columns[0].id;
        }

        // Legacy map
        return todo.status;
    }, [boardConfig]);

    const loadTags = useMemo(
        () => async () => {
            try {
                const tags = await todosAPI.getTags();
                setAvailableTags(tags);
            } catch (error) {
                console.error("Failed to load tags:", error);
            }
        },
        [todosAPI]
    );

    const loadProjects = useMemo(
        () => async () => {
            try {
                const projects = await todosAPI.getProjects();
                setAvailableProjects(projects);
            } catch (error) {
                console.error("Failed to load projects:", error);
            }
        },
        [todosAPI]
    );

    const loadTodos = useMemo(
        () => async () => {
            setLoading(true);
            try {
                // Always load only active (non-archived) todos for the browser view
                const todosData = await todosAPI.getTodos({ project: filterProject ?? undefined });

                // The getTodos API should already filter out archived items, but let's be explicit
                const activeTodos = todosData.filter(t => !t.archived);

                setTodos(activeTodos);

                // Reload tags and projects after todos change
                await Promise.all([loadTags(), loadProjects()]);
            } catch (error) {
                console.error("Failed to load todos:", error);
            } finally {
                setLoading(false);
            }
        },
        [todosAPI, setLoading, filterProject, loadTags, loadProjects]
    );

    useEffect(() => {
        loadTodos();
    }, [loadTodos]);

    async function createTodo() {
        if (!newTodo.title.trim()) return;

        setLoading(true);
        try {
            const createdTodo = await todosAPI.createTodo({
                title: newTodo.title,
                description: newTodo.description || undefined,
                project: newTodo.project || undefined,
                status: newTodo.status,
                tags: newTodo.tags.length > 0 ? newTodo.tags : undefined,
                dueDate: newTodo.dueDate,
                attachments: newTodo.attachments,
                customColumnId: newTodo.customColumnId,
            });

            // Keep the project populated if viewing from a project
            const projectValue = filterProject && filterProject !== "" ? filterProject : "";
            setNewTodo({
                title: "",
                description: "",
                project: projectValue,
                status: "todo",
                tags: [],
                dueDate: undefined,
                attachments: undefined,
            });
            setCreateDialogOpen(false);
            await loadTodos();

            // Focus selection on the newly created todo
            if (createdTodo?.id) {
                setSelectedTodoId(createdTodo.id);
            }
        } catch (error) {
            console.error("Failed to create todo:", error);
        } finally {
            setLoading(false);
        }
    }

    const handleOpenTodo = useCallback(async (todoId: string) => {
        const todo = todos.find((t) => t.id === todoId);
        if (todo) {
            setTodoToEdit(todo);
            setEditDialogOpen(true);
        }
    }, [todos]);

    const handleSaveTodo = async (updatedTodo: Todo) => {
        setEditSaving(true);
        try {
            await todosAPI.updateTodo({
                todoId: updatedTodo.id,
                updates: {
                    title: updatedTodo.title,
                    description: updatedTodo.description,
                    status: updatedTodo.status,
                    project: updatedTodo.project,
                    tags: updatedTodo.tags,
                    dueDate: updatedTodo.dueDate,
                    attachments: updatedTodo.attachments,
                    customColumnId: updatedTodo.customColumnId,
                },
            });
            setEditDialogOpen(false);
            setTodoToEdit(null);
            await loadTodos();
        } catch (error) {
            console.error("Failed to save todo:", error);
        } finally {
            setEditSaving(false);
        }
    };

    const openArchivedView = () => {
        openTab({
            pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
            view: "archived",
            props: { project: filterProject }
        });
    };

    const archiveAllDone = async () => {
        const doneTodos = todos.filter(t => t.status === "done");
        if (doneTodos.length === 0) return;

        setLoading(true);
        try {
            await Promise.all(doneTodos.map(t => todosAPI.archiveTodo({ todoId: t.id })));
            await loadTodos();
        } catch (error) {
            console.error("Failed to archive done todos:", error);
        } finally {
            setLoading(false);
        }
    };

    // Drag and drop handlers
    const handleDragStart = useCallback((event: DragStartEvent) => {
        const todo = todos.find(t => t.id === event.active.id);
        setDraggedTodo(todo || null);
    }, [todos]);

    const handleDragOver = useCallback((_event: DragOverEvent) => {
        // We handle drag over for cross-column drops
    }, []);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;
        setDraggedTodo(null);

        if (!over) return;

        try {
            const activeId = active.id as string;
            const overId = over.id as string;

            // Find the dragged todo
            const activeIndex = todos.findIndex(t => t.id === activeId);
            if (activeIndex === -1) return;

            const activeTodo = todos[activeIndex];
            if (!activeTodo) return;

            // Determine if this is a cross-column drop or same-column reorder
            if (overId.startsWith('column-')) {
                // Cross-column drop - change status or customColumnId depending on mode
                const newColumnId = overId.replace('column-', '');

                if (boardConfig) {
                    // Custom board mode - update customColumnId and optionally status
                    const currentColumnId = getColumnForTodo(activeTodo);
                    if (newColumnId !== currentColumnId) {
                        // Find the target column to check if it has a status mapping
                        const targetColumn = boardConfig.columns.find(c => c.id === newColumnId);
                        const newStatus = targetColumn?.status;

                        // Optimistic update
                        setTodos(prev => prev.map(t =>
                            t.id === activeId
                                ? { ...t, customColumnId: newColumnId, ...(newStatus && { status: newStatus }) }
                                : t
                        ));

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: {
                                    customColumnId: newColumnId,
                                    ...(newStatus && { status: newStatus }),
                                },
                            });
                        } catch (error) {
                            console.error("Failed to update todo column:", error);
                            await loadTodos();
                        }
                    }
                } else {
                    // Legacy mode - update status
                    const newStatus = newColumnId as "todo" | "in_progress" | "done" | "later";
                    if (newStatus !== activeTodo.status) {
                        setTodos(prev => prev.map(t =>
                            t.id === activeId ? { ...t, status: newStatus } : t
                        ));

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: { status: newStatus },
                            });
                        } catch (error) {
                            console.error("Failed to update todo status:", error);
                            await loadTodos();
                        }
                    }
                }
            } else {
                // Dropping on a specific card - either same column reorder or cross-column with position
                const overIndex = todos.findIndex(t => t.id === overId);
                if (overIndex === -1) return;

                const overTodo = todos[overIndex];
                if (!overTodo) return;

                // Determine cross-column based on mode
                const activeColumnId = getColumnForTodo(activeTodo);
                const overColumnId = getColumnForTodo(overTodo);
                const isCrossColumn = activeColumnId !== overColumnId;

                if (isCrossColumn) {
                    // Cross-column drop onto a specific card
                    if (boardConfig) {
                        // Custom board mode - update customColumnId and position
                        const targetColumnTodos = todos.filter(t => getColumnForTodo(t) === overColumnId && t.id !== activeId);
                        const overIndexInColumn = targetColumnTodos.findIndex(t => t.id === overId);

                        // Find the target column to check if it has a status mapping
                        const targetColumn = boardConfig.columns.find(c => c.id === overColumnId);
                        const newStatus = targetColumn?.status;

                        const newColumnTodos = [...targetColumnTodos];
                        newColumnTodos.splice(overIndexInColumn, 0, {
                            ...activeTodo,
                            customColumnId: overColumnId,
                            ...(newStatus && { status: newStatus }),
                        });

                        const reorders = newColumnTodos.map((todo, index) => ({
                            todoId: todo.id,
                            order: index + 1,
                        }));

                        // Optimistic update
                        setTodos(prev => {
                            const updated = prev.map(t => {
                                if (t.id === activeId) {
                                    return {
                                        ...t,
                                        customColumnId: overColumnId,
                                        order: overIndexInColumn + 1,
                                        ...(newStatus && { status: newStatus }),
                                    };
                                }
                                const reorder = reorders.find(r => r.todoId === t.id);
                                if (reorder) {
                                    return { ...t, order: reorder.order };
                                }
                                return t;
                            });
                            return updated;
                        });

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: {
                                    customColumnId: overColumnId,
                                    ...(newStatus && { status: newStatus }),
                                },
                            });
                            await todosAPI.reorderTodos({ reorders });
                        } catch (error) {
                            console.error("Failed to move todo:", error);
                            await loadTodos();
                        }
                    } else {
                        // Legacy mode - update status AND position
                        const targetStatus = overTodo.status;
                        const targetColumnTodos = todos.filter(t => t.status === targetStatus);
                        const overIndexInColumn = targetColumnTodos.findIndex(t => t.id === overId);

                        const updatedActiveTodo = { ...activeTodo, status: targetStatus, order: overIndexInColumn + 1 };
                        const newColumnTodos = [...targetColumnTodos];
                        newColumnTodos.splice(overIndexInColumn, 0, updatedActiveTodo);

                        const reorders = newColumnTodos.map((todo, index) => ({
                            todoId: todo.id,
                            order: index + 1,
                        }));

                        setTodos(prev => {
                            const updated = prev.map(t => {
                                if (t.id === activeId) {
                                    return { ...t, status: targetStatus, order: overIndexInColumn + 1 };
                                }
                                const reorder = reorders.find(r => r.todoId === t.id);
                                if (reorder) {
                                    return { ...t, order: reorder.order };
                                }
                                return t;
                            });
                            return updated;
                        });

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: { status: targetStatus },
                            });
                            await todosAPI.reorderTodos({ reorders });
                        } catch (error) {
                            console.error("Failed to move todo:", error);
                            await loadTodos();
                        }
                    }
                } else {
                    // Same column reorder
                    if (activeIndex !== overIndex) {
                        const columnTodos = todos.filter(t => getColumnForTodo(t) === activeColumnId);
                        const reorderedTodos = arrayMove(
                            columnTodos,
                            columnTodos.findIndex(t => t.id === activeId),
                            columnTodos.findIndex(t => t.id === overId)
                        );

                        const reorders = reorderedTodos.map((todo, index) => ({
                            todoId: todo.id,
                            order: index + 1,
                        }));

                        const newTodos = [...todos];
                        reorderedTodos.forEach((todo, index) => {
                            const idx = newTodos.findIndex(t => t.id === todo.id);
                            if (idx !== -1) {
                                newTodos[idx] = { ...newTodos[idx], order: index + 1 };
                            }
                        });
                        setTodos(newTodos);

                        try {
                            await todosAPI.reorderTodos({ reorders });
                        } catch (error) {
                            console.error("Failed to reorder todos:", error);
                            await loadTodos();
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error in drag end handler:", error);
            await loadTodos();
        }
    }, [todos, todosAPI, loadTodos, boardConfig, getColumnForTodo]);

    const handleTagToggle = (tag: string) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        );
    };

    const handleClearAllTags = () => {
        setSelectedTags([]);
    };

    // Fuzzy search function
    const fuzzySearch = (query: string, text: string): boolean => {
        // Escape regex special characters in each character before joining
        const escapeRegex = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = query.toLowerCase().split("").map(escapeRegex).join(".*");
        const regex = new RegExp(pattern);
        return regex.test(text.toLowerCase());
    };



    // --- Dynamic Columns Logic ---

    const displayColumns = useMemo<BoardColumn[]>(() => {
        if (boardConfig) {
            // Custom mode
            const cols = [...boardConfig.columns].sort((a, b) => a.order - b.order);
            // We don't filter out done/later here; the user configures them.
            // But if user wants to hide "Done" or something, that might be future work.
            // For now, if "showDone" is false in config, maybe filter? 
            // The spec says "showDone" preference.
            // But custom columns are flexible. 
            // Let's assume all configured columns are shown for now.
            return cols;
        } else {
            // Legacy mode
            const cols: BoardColumn[] = [
                { id: "todo", title: "To Do", order: 1 },
                { id: "in_progress", title: "In Progress", order: 2 },
                { id: "done", title: "Done", order: 3 },
            ];
            if (showLaterColumn) {
                cols.unshift({ id: "later", title: "Later", order: 0 });
            }
            return cols.sort((a, b) => a.order - b.order);
        }
    }, [boardConfig, showLaterColumn]);

    const todosByColumn = useMemo(() => {
        let filteredTodos = todos;

        // Apply search filtering
        if (searchQuery.trim()) {
            filteredTodos = filteredTodos.filter((todo) =>
                fuzzySearch(searchQuery, todo.title) ||
                (todo.description && fuzzySearch(searchQuery, todo.description))
            );
        }

        // Apply tag filtering if tags are selected
        if (selectedTags.length > 0) {
            filteredTodos = filteredTodos.filter((todo) =>
                todo.tags?.some((tag) => selectedTags.includes(tag))
            );
        }

        // Sort by order field (ascending), with undefined/null orders at the end
        const sortByOrder = (a: Todo, b: Todo) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        };

        // Group by column
        const grouped: Record<string, Todo[]> = {};
        displayColumns.forEach(col => {
            grouped[col.id] = [];
        });

        filteredTodos.forEach(todo => {
            const colId = getColumnForTodo(todo);
            if (grouped[colId]) {
                grouped[colId].push(todo);
            } else {
                // If column doesn't exist (e.g. legacy status "later" but column hidden), 
                // maybe ignore or put in default? 
                // For "Later" column toggling logic: 
                // In legacy mode, if showLaterColumn is false, we don't have "later" key.
                // So todos with status "later" won't be shown.
                // This matches current behavior.
            }
        });

        // Sort each column
        Object.keys(grouped).forEach(key => {
            grouped[key].sort(sortByOrder);
        });

        return grouped;
    }, [todos, selectedTags, searchQuery, displayColumns, getColumnForTodo]);

    // Flattened list of all visible todos for keyboard navigation
    const flattenedTodos = useMemo(() => {
        const order: Todo[] = [];
        for (const col of displayColumns) {
            order.push(...(todosByColumn[col.id] || []));
        }
        return order;
    }, [todosByColumn, displayColumns]);

    // Get column and index for a given todo
    const getTodoPosition = useCallback((todoId: string | null): { columnId: string; index: number } | null => {
        if (!todoId) return null;
        for (const col of displayColumns) {
            const index = (todosByColumn[col.id] || []).findIndex(t => t.id === todoId);
            if (index !== -1) {
                return { columnId: col.id, index };
            }
        }
        return null;
    }, [displayColumns, todosByColumn]);

    // Shared delete function with optimistic update and toast (no confirmation dialog)
    const deleteTodoWithToast = useCallback(async (todo: Todo) => {
        // Find next item to select if this todo is currently selected
        let nextSelectedId: string | null = null;
        if (selectedTodoId === todo.id) {
            const pos = getTodoPosition(todo.id);
            if (pos) {
                const columnTodos = todosByColumn[pos.columnId];
                if (columnTodos.length > 1) {
                    const nextIndex = pos.index < columnTodos.length - 1 ? pos.index + 1 : pos.index - 1;
                    nextSelectedId = columnTodos[nextIndex]?.id ?? null;
                }
            }
        }

        // Optimistic update - remove from list
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        if (selectedTodoId === todo.id) {
            setSelectedTodoId(nextSelectedId);
        }

        try {
            await todosAPI.deleteTodo({ todoId: todo.id });

            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast(`Deleted "${truncatedTitle}"`, {
                action: {
                    label: "Undo",
                    onClick: async () => {
                        try {
                            // Recreate the todo
                            await todosAPI.createTodo({
                                title: todo.title,
                                description: todo.description,
                                status: todo.status,
                                project: todo.project,
                                tags: todo.tags,
                                dueDate: todo.dueDate,
                                attachments: todo.attachments,
                            });
                            await loadTodos();
                            toast.success("Restored");
                        } catch (error) {
                            console.error("Failed to restore:", error);
                            toast.error("Failed to restore");
                        }
                    },
                },
            });
        } catch (error) {
            console.error("Failed to delete todo:", error);
            toast.error("Failed to delete");
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos]);

    // Shared archive function with optimistic update and toast
    const archiveTodoWithToast = useCallback(async (todo: Todo) => {
        // Find next item to select if this todo is currently selected
        let nextSelectedId: string | null = null;
        if (selectedTodoId === todo.id) {
            const pos = getTodoPosition(todo.id);
            if (pos) {
                const columnTodos = todosByColumn[pos.columnId];
                if (columnTodos.length > 1) {
                    const nextIndex = pos.index < columnTodos.length - 1 ? pos.index + 1 : pos.index - 1;
                    nextSelectedId = columnTodos[nextIndex]?.id ?? null;
                }
            }
        }

        // Optimistic update - remove from list
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        if (selectedTodoId === todo.id) {
            setSelectedTodoId(nextSelectedId);
        }

        try {
            await todosAPI.archiveTodo({ todoId: todo.id });

            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast(`Archived "${truncatedTitle}"`, {
                action: {
                    label: "Undo",
                    onClick: async () => {
                        try {
                            await todosAPI.unarchiveTodo({ todoId: todo.id });
                            await loadTodos();
                            setSelectedTodoId(todo.id);
                            toast.success("Restored");
                        } catch (error) {
                            console.error("Failed to unarchive:", error);
                            toast.error("Failed to restore");
                        }
                    },
                },
            });
        } catch (error) {
            console.error("Failed to archive todo:", error);
            toast.error("Failed to archive");
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos]);

    // Toggle done status and move to matching column if in custom board mode
    const toggleDoneWithToast = useCallback(async (todo: Todo) => {
        const newStatus = todo.status === "done" ? "todo" : "done";

        // Find target column with matching status (if in custom board mode)
        const targetColumn = boardConfig?.columns.find(c => c.status === newStatus);
        const newColumnId = targetColumn?.id;

        // Optimistic update
        setTodos(prev => prev.map(t =>
            t.id === todo.id
                ? { ...t, status: newStatus, ...(newColumnId && { customColumnId: newColumnId }) }
                : t
        ));

        try {
            await todosAPI.updateTodo({
                todoId: todo.id,
                updates: {
                    status: newStatus,
                    ...(newColumnId && { customColumnId: newColumnId }),
                },
            });
        } catch (error) {
            console.error("Failed to toggle todo status:", error);
            toast.error("Failed to update status");
            await loadTodos();
        }
    }, [todosAPI, loadTodos, boardConfig]);

    // Update selection when filtered todos change
    useEffect(() => {
        if (flattenedTodos.length > 0) {
            // If current selection is not in list, select first item
            if (!selectedTodoId || !flattenedTodos.find(t => t.id === selectedTodoId)) {
                setSelectedTodoId(flattenedTodos[0].id);
            }
        } else {
            setSelectedTodoId(null);
        }
    }, [flattenedTodos, selectedTodoId]);


    // Navigation handlers - column-based
    const navigateDown = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            // No selection, select first todo in first non-empty column
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const columnTodos = todosByColumn[pos.columnId];
        if (pos.index < columnTodos.length - 1) {
            // Move down within column
            setSelectedTodoId(columnTodos[pos.index + 1].id);
        }
        // At bottom of column, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, todosByColumn]);

    const navigateUp = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const columnTodos = todosByColumn[pos.columnId];
        if (pos.index > 0) {
            // Move up within column
            setSelectedTodoId(columnTodos[pos.index - 1].id);
        }
        // At top of column, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, todosByColumn]);

    const navigateRight = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        // Find next column with items
        for (let i = currentColIndex + 1; i < displayColumns.length; i++) {
            const nextCol = displayColumns[i];
            const nextColTodos = todosByColumn[nextCol.id];
            if (nextColTodos.length > 0) {
                // Select same row index or last item if column is shorter
                const targetIndex = Math.min(pos.index, nextColTodos.length - 1);
                setSelectedTodoId(nextColTodos[targetIndex].id);
                return;
            }
        }
        // No column to the right with items, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, displayColumns, todosByColumn]);

    const navigateLeft = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        // Find previous column with items
        for (let i = currentColIndex - 1; i >= 0; i--) {
            const prevCol = displayColumns[i];
            const prevColTodos = todosByColumn[prevCol.id];
            if (prevColTodos.length > 0) {
                // Select same row index or last item if column is shorter
                const targetIndex = Math.min(pos.index, prevColTodos.length - 1);
                setSelectedTodoId(prevColTodos[targetIndex].id);
                return;
            }
        }
        // No column to the left with items, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, displayColumns, todosByColumn]);

    const openSelectedTodo = useCallback(() => {
        if (selectedTodoId) {
            handleOpenTodo(selectedTodoId);
        }
    }, [selectedTodoId, handleOpenTodo]);

    // Move handlers - reorder with Shift+Arrow
    const moveUp = useCallback(async () => {
        if (!selectedTodoId) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos || pos.index === 0) return; // Can't move up if at top

        const columnTodos = todosByColumn[pos.columnId];
        const reorderedTodos = arrayMove(columnTodos, pos.index, pos.index - 1);

        // Create reorder updates
        const reorders = reorderedTodos.map((todo, index) => ({
            todoId: todo.id,
            order: index + 1,
        }));

        // Optimistic update
        setTodos(prev => {
            const newTodos = [...prev];
            reorderedTodos.forEach((todo, index) => {
                const idx = newTodos.findIndex(t => t.id === todo.id);
                if (idx !== -1) {
                    newTodos[idx] = { ...newTodos[idx], order: index + 1 };
                }
            });
            return newTodos;
        });

        try {
            await todosAPI.reorderTodos({ reorders });
        } catch (error) {
            console.error("Failed to reorder todos:", error);
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos]);

    const moveDown = useCallback(async () => {
        if (!selectedTodoId) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) return;

        const columnTodos = todosByColumn[pos.columnId];
        if (pos.index >= columnTodos.length - 1) return; // Can't move down if at bottom

        const reorderedTodos = arrayMove(columnTodos, pos.index, pos.index + 1);

        // Create reorder updates
        const reorders = reorderedTodos.map((todo, index) => ({
            todoId: todo.id,
            order: index + 1,
        }));

        // Optimistic update
        setTodos(prev => {
            const newTodos = [...prev];
            reorderedTodos.forEach((todo, index) => {
                const idx = newTodos.findIndex(t => t.id === todo.id);
                if (idx !== -1) {
                    newTodos[idx] = { ...newTodos[idx], order: index + 1 };
                }
            });
            return newTodos;
        });

        try {
            await todosAPI.reorderTodos({ reorders });
        } catch (error) {
            console.error("Failed to reorder todos:", error);
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos]);

    const moveRight = useCallback(async () => {
        if (!selectedTodoId) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) return;

        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        if (currentColIndex >= displayColumns.length - 1) return; // Can't move right if at rightmost

        const nextCol = displayColumns[currentColIndex + 1];

        // Optimistic update
        // Logic depends on column type: legacy status vs custom column
        if (boardConfig) {
            // Custom mode - change customColumnId and optionally status
            const newStatus = nextCol.status;
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId
                    ? { ...t, customColumnId: nextCol.id, ...(newStatus && { status: newStatus }) }
                    : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: {
                        customColumnId: nextCol.id,
                        ...(newStatus && { status: newStatus }),
                    },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        } else {
            // Legacy mode - change status
            const newStatus = nextCol.id as "todo" | "in_progress" | "done" | "later";
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId ? { ...t, status: newStatus } : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: { status: newStatus },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        }
    }, [selectedTodoId, getTodoPosition, displayColumns, todosAPI, loadTodos, boardConfig]);

    const moveLeft = useCallback(async () => {
        if (!selectedTodoId) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) return;

        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        if (currentColIndex <= 0) return; // Can't move left if at leftmost

        const prevCol = displayColumns[currentColIndex - 1];

        // Optimistic update
        if (boardConfig) {
            // Custom mode - change customColumnId and optionally status
            const newStatus = prevCol.status;
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId
                    ? { ...t, customColumnId: prevCol.id, ...(newStatus && { status: newStatus }) }
                    : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: {
                        customColumnId: prevCol.id,
                        ...(newStatus && { status: newStatus }),
                    },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        } else {
            // Legacy mode - change status
            const newStatus = prevCol.id as "todo" | "in_progress" | "done" | "later";
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId ? { ...t, status: newStatus } : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: { status: newStatus },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        }
    }, [selectedTodoId, getTodoPosition, displayColumns, todosAPI, loadTodos, boardConfig]);

    // Archive selected todo (keyboard shortcut handler - uses shared function)
    const archiveSelected = useCallback(async () => {
        if (!selectedTodoId) return;
        const todoToArchive = todos.find(t => t.id === selectedTodoId);
        if (!todoToArchive) return;
        await archiveTodoWithToast(todoToArchive);
    }, [selectedTodoId, todos, archiveTodoWithToast]);

    // Delete selected todo (keyboard shortcut handler - uses shared function)
    const deleteSelected = useCallback(async () => {
        if (!selectedTodoId) return;
        const todoToDelete = todos.find(t => t.id === selectedTodoId);
        if (!todoToDelete) return;
        await deleteTodoWithToast(todoToDelete);
    }, [selectedTodoId, todos, deleteTodoWithToast]);

    // Copy selected todo to clipboard (title and description)
    const copySelectedTodo = useCallback(async () => {
        if (!selectedTodoId) return;
        const todo = todos.find(t => t.id === selectedTodoId);
        if (!todo) return;

        const content = todo.description
            ? `${todo.title}\n\n${todo.description}`
            : todo.title;

        try {
            await navigator.clipboard.writeText(content);
            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast.success(`Copied "${truncatedTitle}"`);
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
            toast.error("Failed to copy to clipboard");
        }
    }, [selectedTodoId, todos]);

    // Register keyboard shortcuts
    useKeyboardShortcuts([
        {
            id: 'todos.search',
            name: 'Focus Search',
            combo: { key: '/' },
            handler: () => {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            },
            category: 'Navigation',
            priority: 10,
        },
        {
            id: 'todos.navigate-down',
            name: 'Navigate Down',
            combo: { key: 'ArrowDown' },
            handler: navigateDown,
            when: () => flattenedTodos.length > 0 && document.activeElement !== searchInputRef.current,
            category: 'Navigation',
        },
        {
            id: 'todos.navigate-up',
            name: 'Navigate Up',
            combo: { key: 'ArrowUp' },
            handler: navigateUp,
            when: () => flattenedTodos.length > 0 && document.activeElement !== searchInputRef.current,
            category: 'Navigation',
        },
        {
            id: 'todos.navigate-right',
            name: 'Navigate Right',
            combo: { key: 'ArrowRight' },
            handler: navigateRight,
            when: () => flattenedTodos.length > 0 && document.activeElement !== searchInputRef.current,
            category: 'Navigation',
        },
        {
            id: 'todos.navigate-left',
            name: 'Navigate Left',
            combo: { key: 'ArrowLeft' },
            handler: navigateLeft,
            when: () => flattenedTodos.length > 0 && document.activeElement !== searchInputRef.current,
            category: 'Navigation',
        },
        {
            id: 'todos.move-up',
            name: 'Move Up',
            combo: { key: 'ArrowUp', shift: true },
            handler: moveUp,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.move-down',
            name: 'Move Down',
            combo: { key: 'ArrowDown', shift: true },
            handler: moveDown,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.move-right',
            name: 'Move Right',
            combo: { key: 'ArrowRight', shift: true },
            handler: moveRight,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.move-left',
            name: 'Move Left',
            combo: { key: 'ArrowLeft', shift: true },
            handler: moveLeft,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.archive',
            name: 'Archive Todo',
            combo: { key: 'a' },
            handler: archiveSelected,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.delete',
            name: 'Delete Todo',
            combo: { key: 'Delete' },
            handler: deleteSelected,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.delete-backspace',
            name: 'Delete Todo',
            combo: { key: 'Backspace' },
            handler: deleteSelected,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.open',
            name: 'Open Todo',
            combo: { key: 'Enter' },
            handler: openSelectedTodo,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.escape-search',
            name: 'Clear Search',
            combo: { key: 'Escape' },
            handler: () => {
                if (document.activeElement === searchInputRef.current && searchQuery) {
                    setSearchQuery("");
                    return true;
                }
                if (document.activeElement === searchInputRef.current) {
                    searchInputRef.current?.blur();
                    return true;
                }
                return false;
            },
            category: 'Navigation',
        },
        {
            id: 'todos.create',
            name: 'Create Todo',
            combo: { key: 'n', cmd: true },
            handler: () => {
                setCreateDialogOpen(true);
            },
            category: 'Actions',
            priority: 20,
        },
        {
            id: 'todos.create-c',
            name: 'Create Todo',
            combo: { key: 'c' },
            handler: () => {
                setCreateDialogOpen(true);
            },
            when: () => document.activeElement !== searchInputRef.current,
            category: 'Actions',
        },
        {
            id: 'todos.refresh',
            name: 'Refresh Todos',
            combo: { key: 'r', cmd: true },
            handler: () => {
                loadTodos();
            },
            category: 'Actions',
            priority: 10,
        },
        {
            id: 'todos.copy',
            name: 'Copy Todo',
            combo: { key: ';' },
            handler: copySelectedTodo,
            when: () => selectedTodoId !== null && document.activeElement !== searchInputRef.current,
            category: 'Actions',
        }
    ], {
        context: 'plugin:todos',
        onlyWhenActive: true,
        deps: [loadTodos, flattenedTodos, selectedTodoId, searchQuery, navigateDown, navigateUp, navigateLeft, navigateRight, openSelectedTodo, moveUp, moveDown, moveLeft, moveRight, archiveSelected, deleteSelected, copySelectedTodo]
    });

    // Refs for scrolling
    const selectedCardRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // Focus the kanban container when this tab becomes active
    // This ensures keyboard navigation works immediately after clicking the tab
    useEffect(() => {
        // Only focus if this tab is active and not loading
        if (activeTab?.pluginInstance?.viewId === "browser" && scrollContainerRef.current) {
            // Use requestAnimationFrame to ensure the DOM is ready
            requestAnimationFrame(() => {
                scrollContainerRef.current?.focus();
            });
        }
    }, [activeTab?.id, activeTab?.pluginInstance?.viewId]);

    // Scroll to selected item only if off-screen, scroll to top if first in column
    // useLayoutEffect ensures scroll happens synchronously after DOM update
    useLayoutEffect(() => {
        const el = selectedCardRef.current;
        const container = scrollContainerRef.current;
        if (!el || !selectedTodoId || !container) return;

        // Check if selected todo is first in its column
        const selectedTodo = flattenedTodos.find(t => t.id === selectedTodoId);
        if (!selectedTodo) return;

        const colId = getColumnForTodo(selectedTodo);
        const columnTodos = todosByColumn[colId] ?? [];
        const isFirstInColumn = columnTodos[0]?.id === selectedTodoId;

        if (isFirstInColumn) {
            container.scrollTo({ top: 0, behavior: "instant" });
            return;
        }

        // Check visibility relative to the scroll container, not the window
        const containerRect = container.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const isVisible = (
            rect.top >= containerRect.top &&
            rect.bottom <= containerRect.bottom
        );

        if (!isVisible) {
            el.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
    }, [selectedTodoId, flattenedTodos, todosByColumn, getColumnForTodo]);

    // Sortable Todo Card component with drop indicator and selection
    function SortableTodoCard({ todo, isOverThis, isSelected, hideProject }: { todo: Todo; isOverThis: boolean; isSelected: boolean; hideProject?: boolean }) {
        const {
            attributes,
            listeners,
            setNodeRef,
            transform,
            transition,
            isDragging,
        } = useSortable({ id: todo.id });

        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.3 : 1,
            zIndex: isDragging ? 1 : 0,
        };

        // Show drop indicator when hovering over this card (but not when dragging this card)
        const showIndicator = isOverThis && !isDragging;

        return (
            <div
                className="relative"
                ref={isSelected ? selectedCardRef : undefined}
            >
                {/* Drop indicator line */}
                {showIndicator && (
                    <div
                        className="absolute -top-1.5 left-0 right-0 h-0.5 rounded-full z-10"
                        style={{ backgroundColor: currentTheme.styles.contentAccent }}
                    />
                )}
                <div
                    ref={setNodeRef}
                    style={{
                        ...style,
                        outline: isSelected ? `2px solid ${currentTheme.styles.contentAccent}` : undefined,
                        outlineOffset: isSelected ? '1px' : undefined,
                        borderRadius: '8px',
                    }}
                    {...attributes}
                    {...listeners}
                    onClick={() => {
                        setSelectedTodoId(todo.id);
                    }}
                    onDoubleClick={() => handleOpenTodo(todo.id)}
                    className="cursor-move"
                >
                    <TodoCard
                        todo={todo}
                        selected={isSelected}
                        onEdit={(t) => handleOpenTodo(t.id)}
                        onDelete={deleteTodoWithToast}
                        onArchive={archiveTodoWithToast}
                        onToggleDone={toggleDoneWithToast}
                        hideProject={hideProject}
                        hideStatusIcon={true}
                    />
                </div>
            </div>
        );
    }

    function KanbanColumn({
        title,
        columnId,
        todos: columnTodos,
        icon,
        accentColor,
        onAddTodo,
    }: {
        title: string;
        columnId: string;
        todos: Todo[];
        icon: React.ReactNode;
        accentColor: string;
        onAddTodo: () => void;
    }) {
        const { setNodeRef, isOver } = useDroppable({
            id: `column-${columnId}`,
        });
        const [headerHovered, setHeaderHovered] = useState(false);

        // Get the currently dragged and hovered item from DndContext
        const { active, over } = useDndContext();
        const overId = over?.id as string | undefined;
        const activeId = active?.id as string | undefined;

        // Ensure columnTodos is always an array
        const safeColumnTodos = Array.isArray(columnTodos) ? columnTodos : [];

        return (
            <div className="flex-1 min-w-0 flex flex-col">
                <div
                    className="flex items-center gap-2 mb-3 flex-shrink-0 group cursor-pointer"
                    onMouseEnter={() => setHeaderHovered(true)}
                    onMouseLeave={() => setHeaderHovered(false)}
                    onClick={onAddTodo}
                >
                    {icon}
                    <h3 className="font-semibold text-sm">{title}</h3>
                    <Badge variant="secondary" className="text-xs">
                        {safeColumnTodos.length}
                    </Badge>
                    <button
                        type="button"
                        className="ml-auto p-1 rounded hover:bg-muted transition-opacity"
                        style={{
                            opacity: headerHovered ? 1 : 0,
                            color: currentTheme.styles.contentSecondary,
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddTodo();
                        }}
                    >
                        <Plus className="size-4" />
                    </button>
                </div>
                <SortableContext items={safeColumnTodos.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div
                        ref={setNodeRef}
                        className="space-y-2 bg-muted/30 rounded-lg py-3 px-1.5 transition-all duration-200"
                        style={{
                            border: isOver
                                ? `1.5px solid ${accentColor}60`
                                : '1.5px solid transparent',
                        }}
                    >
                        {safeColumnTodos.map((todo) => (
                            <SortableTodoCard
                                key={todo.id}
                                todo={todo}
                                isOverThis={overId === todo.id && activeId !== todo.id}
                                isSelected={selectedTodoId === todo.id}
                                hideProject={!!filterProject}
                            />
                        ))}
                        {safeColumnTodos.length === 0 && (
                            <div className="text-center text-muted-foreground text-sm py-8">
                                Drop tasks here
                            </div>
                        )}
                    </div>
                </SortableContext>
            </div>
        );
    }

    return (
        <div className="px-6 py-4 h-full flex flex-col overflow-hidden">
            {/* Project header when viewing a specific project */}
            {filterProject && (
                <h1 className="text-2xl font-bold mb-4 flex-shrink-0">{filterProject}</h1>
            )}
            <div className="flex items-center justify-between flex-shrink-0 mb-6">
                <div className="flex items-center gap-3">
                    <CreateTodoDialog
                        open={createDialogOpen}
                        onOpenChange={setCreateDialogOpen}
                        newTodo={newTodo}
                        onNewTodoChange={setNewTodo}
                        onCreateTodo={createTodo}
                        loading={loading}
                        projectLocked={!!filterProject}
                        availableTags={availableTags}
                        availableProjects={availableProjects}
                    />
                    <div className="relative w-64">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: currentTheme.styles.contentTertiary }} />
                        <Input
                            ref={searchInputRef}
                            placeholder="Search todos..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ color: currentTheme.styles.contentPrimary }}
                            onKeyDown={(e) => {
                                if (flattenedTodos.length === 0) return;

                                // Shift+Arrow = move card
                                if (e.shiftKey) {
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        moveDown();
                                    } else if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        moveUp();
                                    } else if (e.key === "ArrowRight") {
                                        e.preventDefault();
                                        moveRight();
                                    } else if (e.key === "ArrowLeft") {
                                        e.preventDefault();
                                        moveLeft();
                                    }
                                    return;
                                }

                                // Arrow = navigate
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    navigateDown();
                                } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    navigateUp();
                                } else if (e.key === "ArrowRight") {
                                    e.preventDefault();
                                    navigateRight();
                                } else if (e.key === "ArrowLeft") {
                                    e.preventDefault();
                                    navigateLeft();
                                } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    openSelectedTodo();
                                } else if (e.key === "Escape") {
                                    if (searchQuery) {
                                        e.preventDefault();
                                        setSearchQuery("");
                                    } else {
                                        searchInputRef.current?.blur();
                                    }
                                }
                            }}
                            className="pl-8 h-9"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <TagFilter
                        availableTags={availableTags}
                        selectedTags={selectedTags}
                        onTagToggle={handleTagToggle}
                        onClearAll={handleClearAllTags}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <MoreHorizontal className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            style={{
                                backgroundColor: currentTheme.styles.surfacePrimary,
                                borderColor: currentTheme.styles.borderDefault,
                            }}
                        >
                            <DropdownMenuItem
                                onClick={openArchivedView}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <Archive className="w-4 h-4 mr-2" />
                                Open Archived
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={archiveAllDone}
                                disabled={todos.filter(t => t.status === "done").length === 0}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <Archive className="w-4 h-4 mr-2" />
                                Archive All Done ({todos.filter(t => t.status === "done").length})
                            </DropdownMenuItem>

                            {/* Board Settings Link - Show for project views */}
                            {filterProject && filterProject !== "" && (
                                <DropdownMenuItem
                                    onClick={() => setBoardSettingsOpen(true)}
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                >
                                    <Settings className="w-4 h-4 mr-2" />
                                    {boardConfig ? "Board Settings" : "Setup Custom Board"}
                                </DropdownMenuItem>
                            )}

                            <DropdownMenuItem
                                onClick={toggleShowLaterColumn}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                {showLaterColumn ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                                {showLaterColumn ? "Hide Later Column" : "Show Later Column"}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Kanban Board */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div ref={scrollContainerRef} tabIndex={0} className="flex gap-6 flex-1 overflow-y-auto outline-none">
                    {displayColumns.map((col) => {
                        let Icon = Circle;
                        if (col.id === "todo") Icon = AlertCircle;
                        else if (col.id === "in_progress") Icon = Clock;
                        else if (col.id === "done") Icon = CheckCircle2;
                        else if (col.id === "later") Icon = Calendar;

                        return (
                            <KanbanColumn
                                key={col.id}
                                title={col.title}
                                columnId={col.id}
                                todos={todosByColumn[col.id] || []}
                                icon={<Icon className="w-4 h-4" style={{ color: currentTheme.styles.contentSecondary }} />}
                                accentColor={currentTheme.styles.contentAccent}
                                onAddTodo={() => {
                                    if (boardConfig) {
                                        openCreateDialogWithStatus("todo", col.id);
                                    } else {
                                        // Legacy: col.id is the status
                                        openCreateDialogWithStatus(col.id as any);
                                    }
                                }}
                            />
                        );
                    })}
                </div>
                <DragOverlay>
                    {draggedTodo ? (
                        <div className="transform rotate-2 opacity-80">
                            <TodoCard
                                todo={draggedTodo}
                                onEdit={() => { }}
                                onDelete={() => { }}
                                onArchive={() => { }}
                                hideProject={!!filterProject}
                                hideStatusIcon={true}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Edit Todo Modal */}
            <TaskCardEditor todo={todoToEdit} open={editDialogOpen} onOpenChange={setEditDialogOpen} onSave={handleSaveTodo} saving={editSaving} availableTags={availableTags} availableProjects={availableProjects} />

            {/* Board Settings Dialog - Show for project views */}
            {filterProject && filterProject !== "" && (
                <BoardSettingsDialog
                    open={boardSettingsOpen}
                    onOpenChange={setBoardSettingsOpen}
                    config={boardConfig || {
                        columns: getDefaultColumns(),
                        showDone: true,
                    }}
                    onSave={async (newConfig) => {
                        try {
                            const savedProject = await todosAPI.saveBoardConfig({
                                projectName: filterProject,
                                board: newConfig
                            });
                            setBoardConfig(savedProject.board || null);
                            toast.success(boardConfig ? "Board settings saved" : "Custom board created!");
                            // Reload todos in case custom column IDs were mapped or logic changed
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to save board config", error);
                            toast.error("Failed to save settings");
                        }
                    }}
                    onDeleteColumn={async (columnId) => {
                        try {
                            // Backend migration of todos + column deletion
                            await todosAPI.deleteColumn({
                                projectId: filterProject,
                                columnId: columnId,
                            });
                            // Refresh todos to see them in new columns
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to delete column", error);
                            toast.error("Failed to delete column");
                            throw error; // Re-throw to let dialog handle UI state if needed
                        }
                    }}
                />
            )}
        </div>
    );
}
