import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Circle, Loader2, CheckCircle2, Clock, Folder, Tag, X, Plus } from "lucide-react";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useTheme } from "@/hooks/useTheme";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useCollab } from "@/contexts/CollabContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useKanban } from "./useKanban";
import { todosPluginSerial } from "./index";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";

interface CreateTodoCommandDialogProps {
    onSuccess?: (todoId: string) => void;
}

const statusConfig = [
    { value: "todo", label: "Todo", icon: Circle },
    { value: "in_progress", label: "In Progress", icon: Loader2 },
    { value: "done", label: "Done", icon: CheckCircle2 },
    { value: "later", label: "Later", icon: Clock },
] as const;

export function CreateTodoCommandDialog({ onSuccess }: CreateTodoCommandDialogProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [project, setProject] = useState("");
    const [status, setStatus] = useState<"todo" | "in_progress" | "done" | "later">("todo");
    const [tags, setTags] = useState<string[]>([]);
    const [isCreating, setIsCreating] = useState(false);

    const [statusOpen, setStatusOpen] = useState(false);
    const [statusHighlightIndex, setStatusHighlightIndex] = useState(-1);
    const [projectOpen, setProjectOpen] = useState(false);
    const [projectHighlightIndex, setProjectHighlightIndex] = useState(-1);
    const [projectInput, setProjectInput] = useState("");
    const [tagsOpen, setTagsOpen] = useState(false);
    const [tagInput, setTagInput] = useState("");

    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);

    const projectInputRef = useRef<HTMLInputElement>(null);
    const statusTriggerRef = useRef<HTMLButtonElement>(null);
    const projectTriggerRef = useRef<HTMLButtonElement>(null);

    const { closeDialog } = useCommandDialog();
    const { addNewTab, setActiveTabId } = useWorkspaceContext();
    const collab = useCollab();
    const { appMode } = useWorkspaceSwitcher();
    const isTeamCollabMode = appMode === "team" && !!collab;

    const restAPI = useTodosAPI();
    const boardProject = project.trim() === "" ? "" : project.trim();
    const kanban = useKanban({
        project: boardProject,
        enabled: isTeamCollabMode,
    });
    const writeAPI = isTeamCollabMode ? kanban : restAPI;

    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Handle Cmd+Enter from native Mac app
    useNativeSubmit(() => {
        if (title.trim() && !isCreating) {
            // Need to call handleSubmit but it's defined later, so inline the logic trigger
            document.querySelector<HTMLButtonElement>('[data-create-todo-submit]')?.click();
        }
    });

    // Load available tags and projects on mount
    useEffect(() => {
        async function loadData() {
            try {
                const [tagsData, projectsData] = isTeamCollabMode
                    ? [kanban.tags, kanban.projects]
                    : await Promise.all([
                        restAPI.getTags(),
                        restAPI.getProjects(),
                    ]);
                setAvailableTags(tagsData);
                setAvailableProjects(projectsData);
            } catch (error) {
                console.error("Failed to load tags/projects:", error);
            }
        }
        loadData();
    }, [isTeamCollabMode, kanban.tags, kanban.projects, restAPI]);

    // Filter projects based on input
    const filteredProjects = availableProjects.filter(p =>
        p.toLowerCase().includes(projectInput.toLowerCase())
    );

    // Reset highlight index when status popover opens
    const handleStatusOpenChange = (open: boolean) => {
        setStatusOpen(open);
        if (open) {
            const currentIndex = statusConfig.findIndex(s => s.value === status);
            setStatusHighlightIndex(currentIndex >= 0 ? currentIndex : 0);
        }
    };

    // Reset project state when popover opens
    const handleProjectOpenChange = (open: boolean) => {
        setProjectOpen(open);
        if (open) {
            setProjectInput(project);
            setProjectHighlightIndex(-1);
            setTimeout(() => projectInputRef.current?.focus(), 0);
        }
    };

    // Handle keyboard navigation for status
    const handleStatusKeyDown = (e: React.KeyboardEvent) => {
        if (!statusOpen) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleStatusOpenChange(true);
            }
            return;
        }

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setStatusHighlightIndex(prev =>
                    prev < statusConfig.length - 1 ? prev + 1 : 0
                );
                break;
            case "ArrowUp":
                e.preventDefault();
                setStatusHighlightIndex(prev =>
                    prev > 0 ? prev - 1 : statusConfig.length - 1
                );
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                if (statusHighlightIndex >= 0 && statusHighlightIndex < statusConfig.length) {
                    setStatus(statusConfig[statusHighlightIndex].value);
                    setStatusOpen(false);
                    statusTriggerRef.current?.focus();
                }
                break;
            case "Escape":
                e.preventDefault();
                setStatusOpen(false);
                statusTriggerRef.current?.focus();
                break;
        }
    };

    // Handle keyboard navigation for projects
    const handleProjectKeyDown = (e: React.KeyboardEvent) => {
        const items = filteredProjects;

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setProjectHighlightIndex(prev =>
                    prev < items.length - 1 ? prev + 1 : 0
                );
                break;
            case "ArrowUp":
                e.preventDefault();
                setProjectHighlightIndex(prev =>
                    prev > 0 ? prev - 1 : items.length - 1
                );
                break;
            case "Enter":
                e.preventDefault();
                if (projectHighlightIndex >= 0 && projectHighlightIndex < items.length) {
                    setProject(items[projectHighlightIndex]);
                    setProjectOpen(false);
                    projectTriggerRef.current?.focus();
                } else if (projectInput.trim()) {
                    setProject(projectInput.trim());
                    setProjectOpen(false);
                    projectTriggerRef.current?.focus();
                }
                break;
            case "Escape":
                e.preventDefault();
                setProjectOpen(false);
                projectTriggerRef.current?.focus();
                break;
        }
    };

    const currentStatus = statusConfig.find(s => s.value === status) || statusConfig[0];
    const StatusIcon = currentStatus.icon;

    const addTag = (tag: string) => {
        const trimmed = tag.trim();
        if (trimmed && !tags.includes(trimmed)) {
            setTags([...tags, trimmed]);
        }
        setTagInput("");
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(t => t !== tagToRemove));
    };

    const handleSubmit = async () => {
        if (!title.trim()) return;

        setIsCreating(true);
        try {
            const newTodo = await writeAPI.createTodo({
                title: title.trim(),
                description: description.trim() || undefined,
                project: project.trim() || undefined,
                status,
                tags: tags.length > 0 ? tags : undefined,
            });

            closeDialog();
            onSuccess?.(newTodo.id);

            // Open the todos browser view
            const newTab = addNewTab({
                pluginMeta: todosPluginSerial,
                view: "browser",
                props: project ? { project } : {},
            });

            if (newTab) {
                setActiveTabId(newTab.id);
            }
        } catch (error) {
            console.error("Failed to create todo:", error);
        } finally {
            setIsCreating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && title.trim() && !isCreating) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div
            className="flex flex-col -m-6"
            style={{ backgroundColor: styles.surfacePrimary }}
        >
            {/* Content Area */}
            <div className="px-6 pt-6 pb-4 space-y-4">
                {/* Title */}
                <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Task title"
                    className="text-xl font-semibold border-0 px-0 h-auto focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/40"
                    style={{
                        color: styles.contentPrimary,
                        backgroundColor: 'transparent',
                    }}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    disabled={isCreating}
                />

                {/* Description */}
                <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add description..."
                    className="resize-none text-sm border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40"
                    style={{
                        color: styles.contentPrimary,
                        backgroundColor: 'transparent',
                        minHeight: '120px',
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={isCreating}
                />

                {/* Tags Row - displayed inline */}
                {tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        {tags.map((tag, tagIndex) => (
                            <span
                                key={`${tag}-${tagIndex}`}
                                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium"
                                style={{
                                    backgroundColor: styles.surfaceTertiary,
                                    color: styles.contentPrimary,
                                }}
                            >
                                {tag}
                                <button
                                    type="button"
                                    onClick={() => removeTag(tag)}
                                    className="p-0.5 rounded-full hover:bg-black/10 transition-colors"
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div
                className="px-6 py-3 flex items-center justify-between"
                style={{
                    backgroundColor: styles.surfaceSecondary,
                    borderTop: `1px solid ${styles.borderDefault}`,
                }}
            >
                {/* Metadata Pills */}
                <div className="flex items-center gap-2">
                    {/* Status Pill */}
                    <Popover open={statusOpen} onOpenChange={handleStatusOpenChange}>
                        <PopoverTrigger asChild>
                            <button
                                ref={statusTriggerRef}
                                type="button"
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                                style={{
                                    backgroundColor: styles.surfaceTertiary,
                                    color: styles.contentPrimary,
                                    minWidth: '110px',
                                }}
                                onKeyDown={handleStatusKeyDown}
                                disabled={isCreating}
                            >
                                <StatusIcon className="size-4 shrink-0" />
                                <span className="whitespace-nowrap">{currentStatus.label}</span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="w-40 p-1"
                            align="start"
                            style={{
                                backgroundColor: styles.surfacePrimary,
                                borderColor: styles.borderDefault,
                            }}
                            onKeyDown={handleStatusKeyDown}
                        >
                            {statusConfig.map((statusItem, index) => {
                                const Icon = statusItem.icon;
                                const isActive = status === statusItem.value;
                                const isHighlighted = index === statusHighlightIndex;
                                return (
                                    <button
                                        key={statusItem.value}
                                        type="button"
                                        onClick={() => {
                                            setStatus(statusItem.value);
                                            setStatusOpen(false);
                                            statusTriggerRef.current?.focus();
                                        }}
                                        className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                                        style={{
                                            backgroundColor: isHighlighted ? styles.surfaceTertiary : isActive ? styles.surfaceTertiary : 'transparent',
                                            color: styles.contentPrimary,
                                            outline: isHighlighted ? `2px solid ${styles.borderDefault}` : 'none',
                                        }}
                                    >
                                        <Icon className="size-4" />
                                        {statusItem.label}
                                    </button>
                                );
                            })}
                        </PopoverContent>
                    </Popover>

                    {/* Project Pill */}
                    <Popover open={projectOpen} onOpenChange={handleProjectOpenChange}>
                        <PopoverTrigger asChild>
                            <button
                                ref={projectTriggerRef}
                                type="button"
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                                style={{
                                    backgroundColor: styles.surfaceTertiary,
                                    color: project ? styles.contentPrimary : styles.contentTertiary,
                                }}
                                disabled={isCreating}
                            >
                                <Folder className="size-4 shrink-0" />
                                <span className="truncate max-w-[100px]">{project || "Project"}</span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="w-52 p-2"
                            align="start"
                            style={{
                                backgroundColor: styles.surfacePrimary,
                                borderColor: styles.borderDefault,
                            }}
                        >
                            <div className="space-y-2">
                                <Input
                                    ref={projectInputRef}
                                    value={projectInput}
                                    onChange={(e) => {
                                        setProjectInput(e.target.value);
                                        setProjectHighlightIndex(-1);
                                    }}
                                    placeholder="Search or create project..."
                                    className="h-9 text-sm"
                                    onKeyDown={handleProjectKeyDown}
                                />
                                {filteredProjects.length > 0 && (
                                    <div className="max-h-40 overflow-y-auto">
                                        {filteredProjects.map((proj, index) => {
                                            const isHighlighted = index === projectHighlightIndex;
                                            const isActive = project === proj;
                                            return (
                                                <button
                                                    key={`${proj}-${index}`}
                                                    type="button"
                                                    onClick={() => {
                                                        setProject(proj);
                                                        setProjectOpen(false);
                                                        projectTriggerRef.current?.focus();
                                                    }}
                                                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                                                    style={{
                                                        backgroundColor: isHighlighted ? styles.surfaceTertiary : isActive ? styles.surfaceTertiary : 'transparent',
                                                        color: styles.contentPrimary,
                                                        outline: isHighlighted ? `2px solid ${styles.borderDefault}` : 'none',
                                                    }}
                                                >
                                                    <Folder className="size-4" />
                                                    {proj}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {projectInput.trim() && !filteredProjects.includes(projectInput.trim()) && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setProject(projectInput.trim());
                                            setProjectOpen(false);
                                            projectTriggerRef.current?.focus();
                                        }}
                                        className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                                        style={{
                                            backgroundColor: 'transparent',
                                            color: styles.contentSecondary,
                                        }}
                                    >
                                        <Plus className="size-4" />
                                        Create "{projectInput.trim()}"
                                    </button>
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Tags Pill */}
                    <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80"
                                style={{
                                    backgroundColor: styles.surfaceTertiary,
                                    color: tags.length ? styles.contentPrimary : styles.contentTertiary,
                                }}
                                disabled={isCreating}
                            >
                                <Tag className="size-4 shrink-0" />
                                <span>Add tag</span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="w-60 p-3"
                            align="start"
                            style={{
                                backgroundColor: styles.surfacePrimary,
                                borderColor: styles.borderDefault,
                            }}
                        >
                            <div className="space-y-3">
                                {/* Add tag input */}
                                <Input
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    placeholder="Type and press Enter..."
                                    className="h-9 text-sm"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && tagInput.trim()) {
                                            e.preventDefault();
                                            addTag(tagInput);
                                        }
                                    }}
                                />
                                {/* Suggestions */}
                                {availableTags.length > 0 && (
                                    <div className="space-y-1.5">
                                        <p className="text-xs font-medium" style={{ color: styles.contentTertiary }}>
                                            Suggestions
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {availableTags
                                                .filter(t => !tags.includes(t))
                                                .slice(0, 6)
                                                .map((tag, tagIndex) => (
                                                    <button
                                                        key={`${tag}-${tagIndex}`}
                                                        type="button"
                                                        onClick={() => addTag(tag)}
                                                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80"
                                                        style={{
                                                            backgroundColor: styles.surfaceTertiary,
                                                            color: styles.contentSecondary,
                                                        }}
                                                    >
                                                        {tag}
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <Button
                        onClick={closeDialog}
                        variant="ghost"
                        size="sm"
                        className="h-9 px-4"
                        disabled={isCreating}
                    >
                        Cancel
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                onClick={handleSubmit}
                                disabled={isCreating || !title.trim()}
                                size="sm"
                                className="h-9 px-4"
                                data-create-todo-submit
                            >
                                <Plus className="size-4 mr-2" />
                                {isCreating ? "Creating..." : "Create"}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent
                            className="z-[100]"
                            style={{
                                backgroundColor: styles.surfaceTertiary,
                                color: styles.contentPrimary,
                                border: `1px solid ${styles.borderDefault}`,
                            }}
                        >
                            <KeyboardIndicator keys={["cmd", "enter"]} />
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}
