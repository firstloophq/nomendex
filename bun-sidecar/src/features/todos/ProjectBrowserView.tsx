import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { todosPluginSerial } from "./index";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Folder, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { Todo } from "./todo-types";

interface ProjectStats {
    id: string;
    name: string;
    project: string;
    isNoProject?: boolean;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    totalCount: number;
    completionPercent: number;
}

export function ProjectBrowserView() {
    const { loading, setLoading } = usePlugin();
    const { replaceTabWithNewView, activeTabId } = useWorkspaceContext();
    const todosAPI = useTodosAPI();
    const { currentTheme } = useTheme();

    const [projects, setProjects] = useState<string[]>([]);
    const [allTodos, setAllTodos] = useState<Todo[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const tableRef = useRef<HTMLTableElement>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const [projectConfigs, todos] = await Promise.all([
                todosAPI.getProjectsList(),
                todosAPI.getTodos()
            ]);
            // Map project configs to names for compatibility
            const projectList = projectConfigs.map((p: any) => p.name);
            setProjects(projectList);
            setAllTodos(todos.filter(t => !t.archived));
        } catch (error) {
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!loading && tableRef.current) {
            tableRef.current.focus();
        }
    }, [loading]);

    const projectStats: ProjectStats[] = useMemo(() => {
        const noProjectTodos = allTodos.filter(t => !t.project || t.project === "");
        const noProjectStats: ProjectStats = {
            id: "__no_project__",
            name: "No Project",
            project: "",
            isNoProject: true,
            todoCount: noProjectTodos.filter(t => t.status === "todo" || t.status === "later").length,
            inProgressCount: noProjectTodos.filter(t => t.status === "in_progress").length,
            doneCount: noProjectTodos.filter(t => t.status === "done").length,
            totalCount: noProjectTodos.length,
            completionPercent: noProjectTodos.length > 0
                ? Math.round((noProjectTodos.filter(t => t.status === "done").length / noProjectTodos.length) * 100)
                : 0,
        };

        const projectStatsList = projects.map(p => {
            const projectTodos = allTodos.filter(t => t.project === p);
            return {
                id: p,
                name: p,
                project: p,
                todoCount: projectTodos.filter(t => t.status === "todo" || t.status === "later").length,
                inProgressCount: projectTodos.filter(t => t.status === "in_progress").length,
                doneCount: projectTodos.filter(t => t.status === "done").length,
                totalCount: projectTodos.length,
                completionPercent: projectTodos.length > 0
                    ? Math.round((projectTodos.filter(t => t.status === "done").length / projectTodos.length) * 100)
                    : 0,
            };
        });

        return [noProjectStats, ...projectStatsList];
    }, [projects, allTodos]);

    const openProject = useCallback(
        (stats: ProjectStats) => {
            if (activeTabId) {
                replaceTabWithNewView(activeTabId, todosPluginSerial, {
                    view: "browser",
                    project: stats.project,
                });
            }
        },
        [activeTabId, replaceTabWithNewView]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            // Don't handle keyboard events if a dialog is open
            if (document.querySelector('[role="dialog"]')) {
                return;
            }

            switch (e.key) {
                case "ArrowDown":
                case "j":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, projectStats.length - 1));
                    break;
                case "ArrowUp":
                case "k":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (projectStats[selectedIndex]) {
                        openProject(projectStats[selectedIndex]);
                    }
                    break;
            }
        },
        [projectStats, selectedIndex, openProject]
    );

    const inProgressTodos = useMemo(() => {
        return allTodos.filter(t => t.status === "in_progress").slice(0, 5);
    }, [allTodos]);

    return (
        <div className="px-6 py-4 space-y-6">
            {/* Main header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                        Todos
                    </h2>
                    <p className="text-sm mt-0.5" style={{ color: currentTheme.styles.contentTertiary }}>
                        {allTodos.length} tasks · {allTodos.filter(t => t.status === "in_progress").length} in progress
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        if (activeTabId) {
                            replaceTabWithNewView(activeTabId, todosPluginSerial, {
                                view: "browser",
                            });
                        }
                    }}
                >
                    View All
                </Button>
            </div>

            {/* In Progress Preview */}
            {inProgressTodos.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" style={{ color: currentTheme.styles.contentAccent }} />
                        <h3 className="text-sm font-medium" style={{ color: currentTheme.styles.contentSecondary }}>
                            In Progress
                        </h3>
                    </div>
                    <div
                        className="rounded-lg p-3 space-y-1"
                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                    >
                        {inProgressTodos.map((todo) => (
                            <div
                                key={todo.id}
                                className="flex items-center gap-3 py-1.5 px-2 rounded cursor-pointer transition-colors hover:bg-opacity-50"
                                style={{ backgroundColor: "transparent" }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceTertiary;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                }}
                                onClick={() => {
                                    if (activeTabId) {
                                        replaceTabWithNewView(activeTabId, todosPluginSerial, {
                                            view: "browser",
                                            project: todo.project ?? null,
                                        });
                                    }
                                }}
                            >
                                <div
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: currentTheme.styles.contentAccent }}
                                />
                                <span
                                    className="text-sm truncate flex-1"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                >
                                    {todo.title}
                                </span>
                                {todo.project && (
                                    <span
                                        className="text-xs truncate max-w-[120px]"
                                        style={{ color: currentTheme.styles.contentTertiary }}
                                    >
                                        {todo.project}
                                    </span>
                                )}
                            </div>
                        ))}
                        {allTodos.filter(t => t.status === "in_progress").length > 5 && (
                            <p
                                className="text-xs pt-1 pl-2"
                                style={{ color: currentTheme.styles.contentTertiary }}
                            >
                                +{allTodos.filter(t => t.status === "in_progress").length - 5} more
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Projects section */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium" style={{ color: currentTheme.styles.contentSecondary }}>
                    Projects
                </h3>
                <Table ref={tableRef} tabIndex={0} onKeyDown={handleKeyDown} className="outline-none">
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12"></TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead className="text-center w-24">Tasks</TableHead>
                            <TableHead className="text-right w-36">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {projectStats.map((stats, index) => {
                            const isSelected = index === selectedIndex;
                            return (
                                <TableRow
                                    key={stats.id}
                                    data-selected={isSelected}
                                    className="cursor-pointer transition-all"
                                    style={{
                                        backgroundColor: isSelected
                                            ? currentTheme.styles.surfaceSecondary
                                            : "transparent",
                                        borderLeft: isSelected
                                            ? `3px solid ${currentTheme.styles.contentAccent}`
                                            : "3px solid transparent",
                                    }}
                                    onClick={() => {
                                        setSelectedIndex(index);
                                        openProject(stats);
                                    }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    {/* Icon */}
                                    <TableCell>
                                        <Folder
                                            className="w-4 h-4"
                                            style={{
                                                color: stats.isNoProject
                                                    ? currentTheme.styles.contentTertiary
                                                    : currentTheme.styles.contentAccent,
                                            }}
                                        />
                                    </TableCell>

                                    {/* Project name */}
                                    <TableCell
                                        className="font-medium"
                                        style={{
                                            color: stats.isNoProject
                                                ? currentTheme.styles.contentTertiary
                                                : currentTheme.styles.contentPrimary,
                                        }}
                                    >
                                        {stats.name}
                                    </TableCell>

                                    {/* Total count */}
                                    <TableCell className="text-center">
                                        <span
                                            className="text-sm tabular-nums"
                                            style={{ color: currentTheme.styles.contentSecondary }}
                                        >
                                            {stats.totalCount || "—"}
                                        </span>
                                    </TableCell>

                                    {/* Status breakdown */}
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-3">
                                            {stats.todoCount > 0 && (
                                                <div className="flex items-center gap-1" title="To do">
                                                    <AlertCircle
                                                        className="w-3.5 h-3.5"
                                                        style={{ color: currentTheme.styles.contentTertiary }}
                                                    />
                                                    <span
                                                        className="text-xs tabular-nums"
                                                        style={{ color: currentTheme.styles.contentSecondary }}
                                                    >
                                                        {stats.todoCount}
                                                    </span>
                                                </div>
                                            )}
                                            {stats.inProgressCount > 0 && (
                                                <div className="flex items-center gap-1" title="In progress">
                                                    <Clock
                                                        className="w-3.5 h-3.5"
                                                        style={{ color: currentTheme.styles.contentAccent }}
                                                    />
                                                    <span
                                                        className="text-xs tabular-nums"
                                                        style={{ color: currentTheme.styles.contentSecondary }}
                                                    >
                                                        {stats.inProgressCount}
                                                    </span>
                                                </div>
                                            )}
                                            {stats.doneCount > 0 && (
                                                <div className="flex items-center gap-1" title="Done">
                                                    <CheckCircle2
                                                        className="w-3.5 h-3.5"
                                                        style={{ color: currentTheme.styles.semanticSuccess }}
                                                    />
                                                    <span
                                                        className="text-xs tabular-nums"
                                                        style={{ color: currentTheme.styles.contentSecondary }}
                                                    >
                                                        {stats.doneCount}
                                                    </span>
                                                </div>
                                            )}
                                            {stats.totalCount === 0 && (
                                                <span
                                                    className="text-xs"
                                                    style={{ color: currentTheme.styles.contentTertiary }}
                                                >
                                                    —
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {projects.length === 0 && !loading && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                    No projects found. Create todos with project names to see them here.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
