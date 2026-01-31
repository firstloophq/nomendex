import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, FolderKanban, Clock, Circle, CheckCircle2, FileText, Pencil, Trash2 } from "lucide-react";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { useTheme } from "@/hooks/useTheme";
import { projectsPluginSerial } from "./index";
import type { ProjectInfo } from "./index";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { cn } from "@/lib/utils";

export function ProjectsBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [projects, setProjects] = useState<(ProjectInfo & { id: string })[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null);
    const { currentTheme } = useTheme();
    const placement = getViewSelfPlacement(tabId);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const hasSetTabNameRef = useRef<boolean>(false);
    const listRef = useRef<HTMLDivElement>(null);

    const todosAPI = useTodosAPI();
    const notesAPI = useNotesAPI();
    const projectsAPI = useProjectsAPI();

    // Set tab name
    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Projects");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, setTabName]);

    // Auto-focus search input when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId && !loading) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, loading]);

    // Load projects with todo and notes counts
    useEffect(() => {
        const fetchProjects = async () => {
            try {
                setLoading(true);
                setError(null);

                // Get list of projects from projects service and all data for stats
                const [projectConfigs, allTodos, allNotes] = await Promise.all([
                    projectsAPI.listProjects(),
                    todosAPI.getTodos(),
                    notesAPI.getNotes(),
                ]);

                // Calculate stats per project
                const projectInfos = projectConfigs.map((config) => {
                    const projectTodos = allTodos.filter((t) => t.project === config.name);
                    const projectNotes = allNotes.filter((n) => n.frontMatter?.project === config.name);

                    return {
                        id: config.id,
                        name: config.name,
                        todoCount: projectTodos.filter((t) => t.status === "todo").length,
                        inProgressCount: projectTodos.filter((t) => t.status === "in_progress").length,
                        doneCount: projectTodos.filter((t) => t.status === "done").length,
                        notesCount: projectNotes.length,
                    };
                });

                // Sort by in-progress + todo count (most active first), then alphabetically
                projectInfos.sort((a, b) => {
                    const activeA = a.inProgressCount + a.todoCount;
                    const activeB = b.inProgressCount + b.todoCount;
                    if (activeB !== activeA) return activeB - activeA;
                    return a.name.localeCompare(b.name);
                });

                setProjects(projectInfos);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch projects";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };
        fetchProjects();
    }, [projectsAPI, todosAPI, notesAPI, setLoading, setError]);

    // Handle project creation
    const handleCreateProject = async (projectName: string) => {
        try {
            setLoading(true);
            // Create project via projects API
            await projectsAPI.createProject({ name: projectName });

            // Refresh projects
            const [projectConfigs, allTodos, allNotes] = await Promise.all([
                projectsAPI.listProjects(),
                todosAPI.getTodos(),
                notesAPI.getNotes(),
            ]);

            // Calculate stats per project
            const projectInfos = projectConfigs.map((config) => {
                const projectTodos = allTodos.filter((t) => t.project === config.name);
                const projectNotes = allNotes.filter((n) => n.frontMatter?.project === config.name);

                return {
                    id: config.id,
                    name: config.name,
                    todoCount: projectTodos.filter((t) => t.status === "todo").length,
                    inProgressCount: projectTodos.filter((t) => t.status === "in_progress").length,
                    doneCount: projectTodos.filter((t) => t.status === "done").length,
                    notesCount: projectNotes.length,
                };
            });

            // Sort by in-progress + todo count (most active first), then alphabetically
            projectInfos.sort((a, b) => {
                const activeA = a.inProgressCount + a.todoCount;
                const activeB = b.inProgressCount + b.todoCount;
                if (activeB !== activeA) return activeB - activeA;
                return a.name.localeCompare(b.name);
            });

            setProjects(projectInfos);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create project";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Refresh projects list (used after rename/delete)
    const refreshProjects = useCallback(async () => {
        try {
            const [projectConfigs, allTodos, allNotes] = await Promise.all([
                projectsAPI.listProjects(),
                todosAPI.getTodos(),
                notesAPI.getNotes(),
            ]);

            const projectInfos = projectConfigs.map((config) => {
                const projectTodos = allTodos.filter((t) => t.project === config.name);
                const projectNotes = allNotes.filter((n) => n.frontMatter?.project === config.name);

                return {
                    id: config.id,
                    name: config.name,
                    todoCount: projectTodos.filter((t) => t.status === "todo").length,
                    inProgressCount: projectTodos.filter((t) => t.status === "in_progress").length,
                    doneCount: projectTodos.filter((t) => t.status === "done").length,
                    notesCount: projectNotes.length,
                };
            });

            projectInfos.sort((a, b) => {
                const activeA = a.inProgressCount + a.todoCount;
                const activeB = b.inProgressCount + b.todoCount;
                if (activeB !== activeA) return activeB - activeA;
                return a.name.localeCompare(b.name);
            });

            setProjects(projectInfos);
        } catch (err) {
            console.error("Failed to refresh projects:", err);
        }
    }, [projectsAPI, todosAPI, notesAPI]);

    // Handle opening rename dialog
    const handleOpenRename = useCallback((project: { id: string; name: string }, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedProject(project);
        setRenameDialogOpen(true);
    }, []);

    // Handle opening delete dialog
    const handleOpenDelete = useCallback((project: { id: string; name: string }, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedProject(project);
        setDeleteDialogOpen(true);
    }, []);

    // Filter projects based on search
    const filteredProjects = searchQuery
        ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : projects;

    // Open project detail view
    const handleOpenProject = useCallback(
        async (projectName: string) => {
            const newTab = await addNewTab({
                pluginMeta: projectsPluginSerial,
                view: "detail",
                props: { projectName },
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

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (filteredProjects.length === 0) return;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, filteredProjects.length - 1));
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    {
                        const selectedProject = filteredProjects[selectedIndex];
                        if (selectedProject) {
                            handleOpenProject(selectedProject.name);
                        }
                    }
                    break;
            }
        },
        [filteredProjects, selectedIndex, handleOpenProject]
    );

    // Reset selection when search changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchQuery]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
            selectedItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [selectedIndex]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading projects...</div>
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

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            {/* Header with search */}
            <div
                className="sticky top-0 z-10 px-4 py-3 border-b"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center gap-3 mb-3">
                    <FolderKanban
                        size={20}
                        style={{ color: currentTheme.styles.contentAccent }}
                    />
                    <h1
                        className="text-xl font-semibold"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        Projects
                    </h1>
                    <span
                        className="text-sm"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        ({projects.length})
                    </span>
                    <div className="ml-auto">
                        <CreateProjectDialog
                            open={createDialogOpen}
                            onOpenChange={setCreateDialogOpen}
                            onCreateProject={handleCreateProject}
                            loading={loading}
                            existingProjects={projects.map(p => p.name)}
                        />
                    </div>
                </div>

                <div className="relative">
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2"
                        size={16}
                        style={{ color: currentTheme.styles.contentTertiary }}
                    />
                    <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search projects..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="pl-9"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            borderColor: currentTheme.styles.borderDefault,
                            color: currentTheme.styles.contentPrimary,
                        }}
                    />
                </div>
            </div>

            {/* Projects list */}
            <div
                ref={listRef}
                className="flex-1 overflow-y-auto p-2"
            >
                {filteredProjects.length === 0 ? (
                    <div
                        className="text-center py-8"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        {searchQuery ? "No projects found" : "No projects yet"}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {filteredProjects.map((project, index) => (
                            <div
                                key={project.name}
                                data-index={index}
                                className={cn(
                                    "group w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors",
                                    "hover:bg-accent/50"
                                )}
                                style={{
                                    backgroundColor: index === selectedIndex
                                        ? currentTheme.styles.surfaceAccent
                                        : "transparent",
                                }}
                            >
                                <button
                                    onClick={() => handleOpenProject(project.name)}
                                    className="flex items-center gap-2 flex-1 text-left focus:outline-none"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                >
                                    <FolderKanban
                                        size={14}
                                        style={{ color: currentTheme.styles.contentAccent }}
                                    />
                                    <span className="font-medium">{project.name}</span>
                                </button>
                                <div className="flex items-center gap-2">
                                    {/* Action buttons - visible on hover */}
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => handleOpenRename({ id: project.id, name: project.name }, e)}
                                            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                                            title="Rename project"
                                            style={{ color: currentTheme.styles.contentSecondary }}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => handleOpenDelete({ id: project.id, name: project.name }, e)}
                                            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                                            title="Delete project"
                                            style={{ color: currentTheme.styles.semanticDestructive }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    {/* Stats */}
                                    <div className="flex items-center gap-3 text-xs ml-2">
                                        {project.notesCount > 0 && (
                                            <span
                                                className="flex items-center gap-1"
                                                style={{ color: currentTheme.styles.contentTertiary }}
                                            >
                                                <FileText size={12} />
                                                {project.notesCount}
                                            </span>
                                        )}
                                        {project.inProgressCount > 0 && (
                                            <span
                                                className="flex items-center gap-1"
                                                style={{ color: currentTheme.styles.contentAccent }}
                                            >
                                                <Clock size={12} />
                                                {project.inProgressCount}
                                            </span>
                                        )}
                                        {project.todoCount > 0 && (
                                            <span
                                                className="flex items-center gap-1"
                                                style={{ color: currentTheme.styles.contentSecondary }}
                                            >
                                                <Circle size={12} />
                                                {project.todoCount}
                                            </span>
                                        )}
                                        {project.doneCount > 0 && (
                                            <span
                                                className="flex items-center gap-1"
                                                style={{ color: currentTheme.styles.semanticSuccess }}
                                            >
                                                <CheckCircle2 size={12} />
                                                {project.doneCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Dialogs */}
            {selectedProject && (
                <>
                    <DeleteProjectDialog
                        open={deleteDialogOpen}
                        onOpenChange={setDeleteDialogOpen}
                        projectId={selectedProject.id}
                        projectName={selectedProject.name}
                        onDeleted={refreshProjects}
                    />
                    <RenameProjectDialog
                        open={renameDialogOpen}
                        onOpenChange={setRenameDialogOpen}
                        projectId={selectedProject.id}
                        projectName={selectedProject.name}
                        existingProjects={projects.map((p) => p.name)}
                        onRenamed={refreshProjects}
                    />
                </>
            )}
        </div>
    );
}

export default ProjectsBrowserView;
