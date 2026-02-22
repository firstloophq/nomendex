import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Circle, Loader2, CheckCircle2, Clock, Folder, Tag, X, CalendarDays, Paperclip } from "lucide-react";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { Calendar } from "@/components/ui/calendar";
import { parseDateFromInput, toLocalDateString, parseLocalDateString } from "@/features/notes/date-utils";
import type { Attachment } from "@/types/attachments";
import { AttachmentThumbnail } from "@/components/AttachmentThumbnail";

interface NewTodo {
    title: string;
    description: string;
    project: string;
    status: "todo" | "in_progress" | "done" | "later";
    tags: string[];
    dueDate?: string;
    attachments?: Attachment[];
}

interface CreateTodoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    newTodo: NewTodo;
    onNewTodoChange: (newTodo: NewTodo) => void;
    onCreateTodo: () => void;
    loading: boolean;
    projectLocked?: boolean;
    availableTags: string[];
    availableProjects: string[];
}

const statusConfig = [
    { value: "todo", label: "Todo", icon: Circle },
    { value: "in_progress", label: "In Progress", icon: Loader2 },
    { value: "done", label: "Done", icon: CheckCircle2 },
    { value: "later", label: "Later", icon: Clock },
] as const;

export function CreateTodoDialog({
    open,
    onOpenChange,
    newTodo,
    onNewTodoChange,
    onCreateTodo,
    loading,
    projectLocked = false,
    availableTags,
    availableProjects
}: CreateTodoDialogProps) {
    const [statusOpen, setStatusOpen] = useState(false);
    const [statusHighlightIndex, setStatusHighlightIndex] = useState(-1);
    const [projectOpen, setProjectOpen] = useState(false);
    const [projectHighlightIndex, setProjectHighlightIndex] = useState(-1);
    const [projectInput, setProjectInput] = useState("");
    const [tagsOpen, setTagsOpen] = useState(false);
    const [tagInput, setTagInput] = useState("");
    const [dueDateOpen, setDueDateOpen] = useState(false);
    const [dueDateInput, setDueDateInput] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const projectInputRef = useRef<HTMLInputElement>(null);
    const statusTriggerRef = useRef<HTMLButtonElement>(null);
    const projectTriggerRef = useRef<HTMLButtonElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Handle file upload
    const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch("/api/uploads", {
                method: "POST",
                body: formData,
            });

            const result = await response.json();
            if (result.success && result.data) {
                return result.data as Attachment;
            }
            console.error("Upload failed:", result.error);
            return null;
        } catch (error) {
            console.error("Upload error:", error);
            return null;
        }
    }, []);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsUploading(true);
        const newAttachments: Attachment[] = [];

        for (const file of files) {
            if (file.type.startsWith("image/")) {
                const attachment = await uploadFile(file);
                if (attachment) {
                    newAttachments.push(attachment);
                }
            }
        }

        if (newAttachments.length > 0) {
            onNewTodoChange({
                ...newTodo,
                attachments: [...(newTodo.attachments || []), ...newAttachments],
            });
        }

        setIsUploading(false);
        e.target.value = "";
    };

    const removeAttachment = (attachmentId: string) => {
        onNewTodoChange({
            ...newTodo,
            attachments: (newTodo.attachments || []).filter(a => a.id !== attachmentId),
        });
    };

    // Handle Cmd+Enter from native Mac app
    useNativeSubmit(() => {
        if (open && newTodo.title.trim() && !loading) {
            onCreateTodo();
        }
    });

    // Filter projects based on input
    const filteredProjects = availableProjects.filter(p =>
        p.toLowerCase().includes(projectInput.toLowerCase())
    );

    // Reset highlight index when status popover opens
    const handleStatusOpenChange = (open: boolean) => {
        setStatusOpen(open);
        if (open) {
            const currentIndex = statusConfig.findIndex(s => s.value === newTodo.status);
            setStatusHighlightIndex(currentIndex >= 0 ? currentIndex : 0);
        }
    };

    // Reset project state when popover opens
    const handleProjectOpenChange = (open: boolean) => {
        if (projectLocked) return;
        setProjectOpen(open);
        if (open) {
            setProjectInput(newTodo.project || "");
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
                    onNewTodoChange({ ...newTodo, status: statusConfig[statusHighlightIndex].value });
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
                    onNewTodoChange({ ...newTodo, project: items[projectHighlightIndex] });
                    setProjectOpen(false);
                    projectTriggerRef.current?.focus();
                } else if (projectInput.trim()) {
                    onNewTodoChange({ ...newTodo, project: projectInput.trim() });
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && newTodo.title.trim() && !loading) {
            e.preventDefault();
            onCreateTodo();
        }
    };

    const currentStatus = statusConfig.find(s => s.value === newTodo.status) || statusConfig[0];
    const StatusIcon = currentStatus.icon;

    const addTag = (tag: string) => {
        const trimmed = tag.trim();
        if (trimmed && !newTodo.tags.includes(trimmed)) {
            onNewTodoChange({
                ...newTodo,
                tags: [...newTodo.tags, trimmed],
            });
        }
        setTagInput("");
    };

    const removeTag = (tagToRemove: string) => {
        onNewTodoChange({
            ...newTodo,
            tags: newTodo.tags.filter(t => t !== tagToRemove),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Todo
                </Button>
            </DialogTrigger>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: '700px',
                    maxWidth: '90vw',
                }}
            >
                {/* Content Area */}
                <div className="px-6 pt-6 pb-4 space-y-4">
                    {/* Title */}
                    <Input
                        value={newTodo.title}
                        onChange={(e) => onNewTodoChange({ ...newTodo, title: e.target.value })}
                        placeholder="Task title"
                        className="text-xl font-semibold border-0 px-0 h-auto focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/40"
                        style={{
                            color: styles.contentPrimary,
                            backgroundColor: 'transparent',
                        }}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />

                    {/* Description */}
                    <Textarea
                        value={newTodo.description}
                        onChange={(e) => onNewTodoChange({ ...newTodo, description: e.target.value })}
                        placeholder="Add description..."
                        className="resize-none text-sm border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40"
                        style={{
                            color: styles.contentPrimary,
                            backgroundColor: 'transparent',
                            minHeight: '180px',
                        }}
                        onKeyDown={handleKeyDown}
                    />

                    {/* Attachments Row */}
                    {(newTodo.attachments && newTodo.attachments.length > 0) && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            {newTodo.attachments.map((attachment) => (
                                <AttachmentThumbnail
                                    key={attachment.id}
                                    attachment={attachment}
                                    onRemove={() => removeAttachment(attachment.id)}
                                    size="md"
                                />
                            ))}
                        </div>
                    )}

                    {/* Tags Row - displayed inline */}
                    {newTodo.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            {newTodo.tags.map((tag, tagIndex) => (
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
                                {statusConfig.map((status, index) => {
                                    const Icon = status.icon;
                                    const isActive = newTodo.status === status.value;
                                    const isHighlighted = index === statusHighlightIndex;
                                    return (
                                        <button
                                            key={status.value}
                                            type="button"
                                            onClick={() => {
                                                onNewTodoChange({ ...newTodo, status: status.value });
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
                                            {status.label}
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
                                        color: newTodo.project ? styles.contentPrimary : styles.contentTertiary,
                                        opacity: projectLocked ? 0.6 : 1,
                                    }}
                                    disabled={projectLocked}
                                >
                                    <Folder className="size-4 shrink-0" />
                                    <span className="truncate max-w-[100px]">{newTodo.project || "Project"}</span>
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
                                            {filteredProjects.map((project, index) => {
                                                const isHighlighted = index === projectHighlightIndex;
                                                const isActive = newTodo.project === project;
                                                return (
                                                    <button
                                                        key={`${project}-${index}`}
                                                        type="button"
                                                        onClick={() => {
                                                            onNewTodoChange({ ...newTodo, project });
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
                                                        {project}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {projectInput.trim() && !filteredProjects.includes(projectInput.trim()) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onNewTodoChange({ ...newTodo, project: projectInput.trim() });
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
                                    className="flex items-center justify-center p-2 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                                    style={{
                                        backgroundColor: styles.surfaceTertiary,
                                        color: newTodo.tags.length ? styles.contentPrimary : styles.contentTertiary,
                                    }}
                                >
                                    <Tag className="size-4" />
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
                                                    .filter(t => !newTodo.tags.includes(t))
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

                        {/* Attachment Pill */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileChange}
                            className="hidden"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="flex items-center justify-center p-2 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                            style={{
                                backgroundColor: styles.surfaceTertiary,
                                color: (newTodo.attachments?.length || 0) > 0 ? styles.contentPrimary : styles.contentTertiary,
                            }}
                            title="Add attachment"
                        >
                            {isUploading ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Paperclip className="size-4" />
                            )}
                        </button>

                        {/* Due Date Pill */}
                        <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                                    style={{
                                        backgroundColor: styles.surfaceTertiary,
                                        color: newTodo.dueDate ? styles.contentPrimary : styles.contentTertiary,
                                    }}
                                >
                                    <CalendarDays className="size-4 shrink-0" />
                                    {newTodo.dueDate && (
                                        <>
                                            <span className="whitespace-nowrap">
                                                {parseLocalDateString(newTodo.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onNewTodoChange({ ...newTodo, dueDate: undefined });
                                                }}
                                                className="p-0.5 rounded-full hover:bg-black/10 transition-colors"
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </>
                                    )}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-auto p-3 z-[100]"
                                align="start"
                                style={{
                                    backgroundColor: styles.surfacePrimary,
                                    borderColor: styles.borderDefault,
                                }}
                            >
                                <div className="space-y-3">
                                    <Input
                                        value={dueDateInput}
                                        onChange={(e) => {
                                            setDueDateInput(e.target.value);
                                            const parsed = parseDateFromInput(e.target.value);
                                            if (parsed) {
                                                onNewTodoChange({ ...newTodo, dueDate: toLocalDateString(parsed) });
                                            }
                                        }}
                                        placeholder="tomorrow, next wed, 1/15..."
                                        className="h-9 text-sm"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                setDueDateOpen(false);
                                            }
                                        }}
                                    />
                                    <Calendar
                                        mode="single"
                                        selected={newTodo.dueDate ? parseLocalDateString(newTodo.dueDate) : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                onNewTodoChange({ ...newTodo, dueDate: toLocalDateString(date) });
                                                setDueDateInput("");
                                                setDueDateOpen(false);
                                            }
                                        }}
                                        defaultMonth={newTodo.dueDate ? parseLocalDateString(newTodo.dueDate) : new Date()}
                                    />
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => onOpenChange(false)}
                            variant="ghost"
                            size="sm"
                            className="h-9 px-4"
                        >
                            Cancel
                        </Button>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={onCreateTodo}
                                    disabled={loading || !newTodo.title.trim()}
                                    size="sm"
                                    className="h-9 px-4"
                                >
                                    <Plus className="size-4 mr-2" />
                                    {loading ? "Creating..." : "Create"}
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
            </DialogContent>
        </Dialog>
    );
}
