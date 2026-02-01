import { Settings, Trash2, Archive, ArchiveRestore, Copy, CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { Todo } from "./todo-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { parseLocalDateString } from "@/features/notes/date-utils";

export function TodoCard({
    todo,
    selected,
    onEdit,
    onDelete,
    onArchive,
    hideProject,
    onToggleDone,
    hideStatusIcon,
}: {
    todo: Todo;
    selected?: boolean;
    onEdit?: (todo: Todo) => void;
    onDelete?: (todo: Todo) => void;
    onArchive?: (todo: Todo) => void;
    hideProject?: boolean;
    onToggleDone?: (todo: Todo) => void;
    hideStatusIcon?: boolean;
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

    const handleToggleDone = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onToggleDone?.(todo);
    };

    return (
        <Card className={`mb-2 hover:shadow-md transition-shadow duration-150 ${todo.archived ? 'opacity-60 bg-muted/30' : ''}`}>
            <CardHeader className="pb-1 pt-2 px-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                        {!hideStatusIcon && (
                            <button
                                type="button"
                                onClick={handleToggleDone}
                                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                title={todo.status === "done" ? "Mark as incomplete" : "Mark as done"}
                            >
                                {todo.status === "done" ? (
                                    <CheckCircle2 className="size-4 text-green-600" />
                                ) : (
                                    <Circle className="size-4" />
                                )}
                            </button>
                        )}
                        <CardTitle className={`text-sm font-medium leading-tight ${todo.status === "done" ? "line-through text-muted-foreground" : ""
                            }`}>
                            {todo.title}
                        </CardTitle>
                    </div>
                    {todo.archived && <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded shrink-0">Archived</span>}
                </div>
                {!hideProject && todo.project && <p className="text-[10px] text-blue-600">{todo.project}</p>}
                {todo.tags && todo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {todo.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0 h-4">
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
                        {parseLocalDateString(todo.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
