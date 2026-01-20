import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FolderKanban, Circle, Clock, CheckCircle2, FileText, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useTheme } from "@/hooks/useTheme";
import { todosPluginSerial } from "@/features/todos";
import { notesPluginSerial } from "@/features/notes";
import { TaskCardEditor } from "@/features/todos/TaskCardEditor";
import type { Todo } from "@/features/todos/todo-types";
import type { Note } from "@/features/notes";
import type { ProjectDetailViewProps } from "./index";

const INITIAL_NOTES_LIMIT = 10;

export function ProjectDetailView({ tabId, projectName }: { tabId: string } & ProjectDetailViewProps) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [showAllNotes, setShowAllNotes] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const { currentTheme } = useTheme();
    const placement = getViewSelfPlacement(tabId);

    const hasSetTabNameRef = useRef<boolean>(false);

    const todosAPI = useTodosAPI();
    const notesAPI = useNotesAPI();

    // Set tab name
    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, projectName);
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, projectName, setTabName]);

    // Load todos, notes, tags, and projects for this project
    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);

                const [todosResult, notesResult, tagsResult, projectsResult] = await Promise.all([
                    todosAPI.getTodos({ project: projectName }),
                    notesAPI.getNotesByProject({ project: projectName }),
                    todosAPI.getTags(),
                    todosAPI.getProjects(),
                ]);

                setTodos(todosResult);
                notesResult.sort((a, b) => a.fileName.localeCompare(b.fileName));
                setNotes(notesResult);
                setAvailableTags(tagsResult);
                setAvailableProjects(projectsResult);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch project data";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [projectName, todosAPI, notesAPI, setLoading, setError]);

    // Open todo in dialog
    const handleOpenTodo = useCallback(
        (todoId: string) => {
            const todo = todos.find((t) => t.id === todoId);
            if (todo) {
                setTodoToEdit(todo);
                setEditDialogOpen(true);
            }
        },
        [todos]
    );

    // Save todo from dialog
    const handleSaveTodo = useCallback(
        async (updatedTodo: Todo) => {
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
                    },
                });
                setEditDialogOpen(false);
                setTodoToEdit(null);
                // Refresh todos
                const todosResult = await todosAPI.getTodos({ project: projectName });
                setTodos(todosResult);
            } catch (err) {
                console.error("Failed to save todo:", err);
            } finally {
                setEditSaving(false);
            }
        },
        [todosAPI, projectName]
    );

    // Open note
    const handleOpenNote = useCallback(
        async (noteFileName: string) => {
            const newTab = await addNewTab({
                pluginMeta: notesPluginSerial,
                view: "editor",
                props: { noteFileName },
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, placement, setActiveTabId, setSidebarTabId]
    );

    // Open kanban board for this project
    const handleOpenKanban = useCallback(
        async () => {
            const newTab = await addNewTab({
                pluginMeta: todosPluginSerial,
                view: "browser",
                props: { project: projectName },
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, placement, setActiveTabId, setSidebarTabId, projectName]
    );

    // Group todos by status
    const inProgressTodos = todos.filter((t) => t.status === "in_progress");
    const todoTodos = todos.filter((t) => t.status === "todo");
    const doneTodos = todos.filter((t) => t.status === "done");
    const otherTodos = todos.filter((t) => !["in_progress", "todo", "done"].includes(t.status));

    // Stats
    const totalItems = todos.length + notes.length;
    const completionRate = todos.length > 0 ? Math.round((doneTodos.length / todos.length) * 100) : 0;

    // Notes to display
    const displayedNotes = showAllNotes ? notes : notes.slice(0, INITIAL_NOTES_LIMIT);
    const hasMoreNotes = notes.length > INITIAL_NOTES_LIMIT;

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertDescription>Error: {error}</AlertDescription>
                </Alert>
            </div>
        );
    }

    // Note card component
    const NoteCard = ({ note }: { note: Note }) => {
        const displayName = note.fileName.replace(/\.md$/, "");
        const preview = note.content.slice(0, 120).trim();

        return (
            <button
                onClick={() => handleOpenNote(note.fileName)}
                className="text-left p-4 rounded-lg transition-all hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-offset-1 flex flex-col justify-start items-start"
                style={{
                    backgroundColor: currentTheme.styles.surfaceSecondary,
                    border: `1px solid ${currentTheme.styles.borderDefault}`,
                }}
            >
                <div
                    className="font-medium truncate"
                    style={{ color: currentTheme.styles.contentPrimary }}
                >
                    {displayName}
                </div>
                {preview && (
                    <div
                        className="text-sm mt-2 line-clamp-2"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        {preview}...
                    </div>
                )}
            </button>
        );
    };

    // Todo card component
    const TodoCard = ({ todo }: { todo: Todo }) => {
        return (
            <button
                onClick={() => handleOpenTodo(todo.id)}
                className="text-left p-4 rounded-lg transition-all hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-offset-1 flex flex-col justify-start items-start"
                style={{
                    backgroundColor: currentTheme.styles.surfaceSecondary,
                    border: `1px solid ${currentTheme.styles.borderDefault}`,
                    opacity: todo.status === "done" ? 0.7 : 1,
                }}
            >
                <div
                    className="font-medium"
                    style={{ color: currentTheme.styles.contentPrimary }}
                >
                    {todo.title}
                </div>
                {todo.description && (
                    <div
                        className="text-sm mt-2 line-clamp-2"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        {todo.description}
                    </div>
                )}
            </button>
        );
    };

    // Section header component
    const SectionHeader = ({ icon: Icon, title, count, color }: { icon: typeof Circle; title: string; count: number; color: string }) => (
        <div className="flex items-center gap-2 mb-3">
            <Icon size={16} style={{ color }} />
            <span className="font-medium" style={{ color }}>{title}</span>
            <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                    backgroundColor: currentTheme.styles.surfaceTertiary,
                    color: currentTheme.styles.contentSecondary
                }}
            >
                {count}
            </span>
        </div>
    );

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            {/* Header */}
            <div
                className="sticky top-0 z-10 px-6 py-4 border-b"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center gap-3 mb-4">
                    <FolderKanban
                        size={28}
                        style={{ color: currentTheme.styles.contentAccent }}
                    />
                    <h1
                        className="text-2xl font-bold"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        {projectName}
                    </h1>
                    <button
                        onClick={handleOpenKanban}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors hover:opacity-80"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.contentAccent,
                            border: `1px solid ${currentTheme.styles.borderDefault}`,
                        }}
                    >
                        <ExternalLink size={14} />
                        Kanban Board
                    </button>
                </div>

                {/* Stats */}
                <div className="flex gap-6">
                    <div
                        className="px-4 py-3 rounded-lg"
                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                    >
                        <div
                            className="text-2xl font-bold"
                            style={{ color: currentTheme.styles.contentPrimary }}
                        >
                            {totalItems}
                        </div>
                        <div
                            className="text-xs uppercase tracking-wider"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            Total Items
                        </div>
                    </div>
                    <div
                        className="px-4 py-3 rounded-lg"
                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                    >
                        <div
                            className="text-2xl font-bold"
                            style={{ color: currentTheme.styles.contentAccent }}
                        >
                            {inProgressTodos.length}
                        </div>
                        <div
                            className="text-xs uppercase tracking-wider"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            In Progress
                        </div>
                    </div>
                    <div
                        className="px-4 py-3 rounded-lg"
                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                    >
                        <div
                            className="text-2xl font-bold"
                            style={{ color: currentTheme.styles.semanticSuccess }}
                        >
                            {completionRate}%
                        </div>
                        <div
                            className="text-xs uppercase tracking-wider"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            Complete
                        </div>
                    </div>
                    <div
                        className="px-4 py-3 rounded-lg"
                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                    >
                        <div
                            className="text-2xl font-bold"
                            style={{ color: currentTheme.styles.contentPrimary }}
                        >
                            {notes.length}
                        </div>
                        <div
                            className="text-xs uppercase tracking-wider"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            Notes
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {totalItems === 0 ? (
                    <div
                        className="text-center py-12"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        No notes or todos in this project yet
                    </div>
                ) : (
                    <>
                        {/* Notes Section */}
                        {notes.length > 0 && (
                            <div>
                                <SectionHeader
                                    icon={FileText}
                                    title="Notes"
                                    count={notes.length}
                                    color={currentTheme.styles.contentAccent}
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ maxWidth: "1200px" }}>
                                    {displayedNotes.map((note) => (
                                        <NoteCard key={note.fileName} note={note} />
                                    ))}
                                </div>
                                {hasMoreNotes && (
                                    <button
                                        onClick={() => setShowAllNotes(!showAllNotes)}
                                        className="mt-3 flex items-center gap-1 text-sm transition-colors hover:opacity-80"
                                        style={{ color: currentTheme.styles.contentAccent }}
                                    >
                                        {showAllNotes ? (
                                            <>
                                                <ChevronUp size={16} />
                                                Show less
                                            </>
                                        ) : (
                                            <>
                                                <ChevronDown size={16} />
                                                Show all {notes.length} notes
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* In Progress Section */}
                        {inProgressTodos.length > 0 && (
                            <div>
                                <SectionHeader
                                    icon={Clock}
                                    title="In Progress"
                                    count={inProgressTodos.length}
                                    color={currentTheme.styles.contentAccent}
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ maxWidth: "1200px" }}>
                                    {inProgressTodos.map((todo) => (
                                        <TodoCard key={todo.id} todo={todo} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Todo Section */}
                        {todoTodos.length > 0 && (
                            <div>
                                <SectionHeader
                                    icon={Circle}
                                    title="Todo"
                                    count={todoTodos.length}
                                    color={currentTheme.styles.contentSecondary}
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ maxWidth: "1200px" }}>
                                    {todoTodos.map((todo) => (
                                        <TodoCard key={todo.id} todo={todo} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Done Section */}
                        {doneTodos.length > 0 && (
                            <div>
                                <SectionHeader
                                    icon={CheckCircle2}
                                    title="Done"
                                    count={doneTodos.length}
                                    color={currentTheme.styles.semanticSuccess}
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ maxWidth: "1200px" }}>
                                    {doneTodos.map((todo) => (
                                        <TodoCard key={todo.id} todo={todo} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Other Section */}
                        {otherTodos.length > 0 && (
                            <div>
                                <SectionHeader
                                    icon={Circle}
                                    title="Other"
                                    count={otherTodos.length}
                                    color={currentTheme.styles.contentTertiary}
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ maxWidth: "1200px" }}>
                                    {otherTodos.map((todo) => (
                                        <TodoCard key={todo.id} todo={todo} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Edit Todo Dialog */}
            <TaskCardEditor
                todo={todoToEdit}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                onSave={handleSaveTodo}
                saving={editSaving}
                availableTags={availableTags}
                availableProjects={availableProjects}
            />
        </div >
    );
}

export default ProjectDetailView;
