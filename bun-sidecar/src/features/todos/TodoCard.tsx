import { Settings, Trash2, Archive, ArchiveRestore, Copy, CalendarDays, Pencil } from "lucide-react";
import { Todo } from "./todo-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { parseLocalDateString } from "@/features/notes/date-utils";
import type { UserInfo } from "@firstloophq-demos/crdt-lib";

export function TodoCard({
    todo,
    selected,
    viewers,
    editingViewers,
    onEdit,
    onDelete,
    onArchive,
    hideProject,
}: {
    todo: Todo;
    selected?: boolean;
    viewers?: ReadonlyArray<UserInfo>;
    editingViewers?: ReadonlyArray<UserInfo>;
    onEdit?: (todo: Todo) => void;
    onDelete?: (todo: Todo) => void;
    onArchive?: (todo: Todo) => void;
    hideProject?: boolean;
}) {
    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const content = todo.description
            ? `${todo.title}\n\n${todo.description}`
            : todo.title;

        try {
            await navigator.clipboard.writeText(content);
            toast("Todo copied to clipboard");
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
            toast("Failed to copy to clipboard");
        }
    };

    const viewerCount = viewers?.length ?? 0;
    const editorCount = editingViewers?.length ?? 0;
    const viewerNames = viewers?.map((viewer) => viewer.name).join(", ") ?? "";
    const editorNames = editingViewers?.map((viewer) => viewer.name).join(", ") ?? "";
    const viewerColor = editingViewers?.[0]?.color ?? viewers?.[0]?.color;

    return (
        <Card className={`mb-2 hover:shadow-md transition-shadow duration-150 ${todo.archived ? 'opacity-60 bg-muted/30' : ''}`}>
            <CardHeader className="pb-1 pt-2 px-3">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium leading-tight flex-1">{todo.title}</CardTitle>
                    <div className="flex items-center gap-1 shrink-0">
                        {viewerCount > 0 && (
                            <span
                                className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[10px] font-semibold text-white"
                                style={{ backgroundColor: viewerColor ?? "#64748b" }}
                                title={viewerNames ? `Viewing: ${viewerNames}` : "Viewing"}
                            >
                                {viewerCount}
                            </span>
                        )}
                        {editorCount > 0 && (
                            <span
                                className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700"
                                title={editorNames ? `Editing: ${editorNames}` : "Editing"}
                            >
                                <Pencil className="size-2.5" />
                                Edit
                            </span>
                        )}
                        {todo.archived && <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">Archived</span>}
                    </div>
                </div>
                {!hideProject && todo.project && <p className="text-[10px] text-blue-600">{todo.project}</p>}
                {todo.tags && todo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {todo.tags.map((tag, tagIndex) => (
                            <Badge key={`${tag}-${tagIndex}`} variant="outline" className="text-[10px] px-1 py-0 h-4">
                                {tag}
                            </Badge>
                        ))}
                    </div>
                )}
            </CardHeader>
            {todo.description && (
                <CardContent className="pt-0 px-3 pb-1">
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{todo.description}</p>
                </CardContent>
            )}
            <div className="px-3 pb-2 flex items-center justify-between">
                {todo.dueDate ? (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {parseLocalDateString(todo.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                ) : (
                    <div />
                )}
                {/* Actions - show when selected */}
                <div className={`flex items-center gap-0.5 transition-opacity duration-0 ${selected ? 'opacity-100' : 'opacity-0'}`}>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit?.(todo);
                        }}
                        title="Edit"
                        aria-label="Edit todo"
                    >
                        <Settings className="size-3" />
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={handleCopy}
                        title="Copy"
                        aria-label="Copy todo content"
                    >
                        <Copy className="size-3" />
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onArchive?.(todo);
                        }}
                        title={todo.archived ? "Unarchive" : "Archive"}
                        aria-label={todo.archived ? "Unarchive todo" : "Archive todo"}
                    >
                        {todo.archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-red-100 text-muted-foreground hover:text-red-600"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete?.(todo);
                        }}
                        title="Delete"
                        aria-label="Delete todo"
                    >
                        <Trash2 className="size-3" />
                    </button>
                </div>
            </div>
        </Card>
    );
}
