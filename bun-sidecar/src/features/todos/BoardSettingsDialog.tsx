import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { BoardConfig, BoardColumn } from "@/features/projects/project-types";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface BoardSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config: BoardConfig;
    onSave: (config: BoardConfig) => Promise<void>;
    onDeleteColumn: (columnId: string) => Promise<void>;
}

const STATUS_OPTIONS = [
    { value: "none", label: "No status" },
    { value: "todo", label: "To Do" },
    { value: "in_progress", label: "In Progress" },
    { value: "done", label: "Done" },
    { value: "later", label: "Later" },
] as const;

interface SortableColumnItemProps {
    column: BoardColumn;
    onTitleChange: (id: string, title: string) => void;
    onStatusChange: (id: string, status: string) => void;
    onDelete: (id: string) => void;
    canDelete: boolean;
}

function SortableColumnItem({ column, onTitleChange, onStatusChange, onDelete, canDelete }: SortableColumnItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: column.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-2 bg-muted/40 p-2 rounded-md"
        >
            <button
                {...attributes}
                {...listeners}
                className="cursor-grab hover:cursor-grabbing shrink-0 touch-none"
                type="button"
            >
                <GripVertical className="size-4 text-muted-foreground" />
            </button>
            <Input
                value={column.title}
                onChange={(e) => onTitleChange(column.id, e.target.value)}
                className="h-8 flex-1"
            />
            <Select
                value={column.status || "none"}
                onValueChange={(value) => onStatusChange(column.id, value)}
            >
                <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(column.id)}
                disabled={!canDelete}
                className="h-8 w-8 p-0 shrink-0"
            >
                <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
            </Button>
        </div>
    );
}

export function BoardSettingsDialog({
    open,
    onOpenChange,
    config,
    onSave,
    onDeleteColumn
}: BoardSettingsDialogProps) {
    const [columns, setColumns] = useState<BoardColumn[]>(config.columns);
    const [newColumnTitle, setNewColumnTitle] = useState("");
    const [saving, setSaving] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const [prevOpen, setPrevOpen] = useState(open);
    if (open !== prevOpen) {
        setPrevOpen(open);
        if (open) {
            setColumns(config.columns);
        }
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setColumns((items) => {
                const oldIndex = items.findIndex((c) => c.id === active.id);
                const newIndex = items.findIndex((c) => c.id === over.id);
                const reordered = arrayMove(items, oldIndex, newIndex);
                // Update order values
                return reordered.map((col, idx) => ({ ...col, order: idx + 1 }));
            });
        }
    };

    const handleAddColumn = () => {
        if (!newColumnTitle.trim()) return;

        const newColumn: BoardColumn = {
            id: `col-${Date.now()}`,
            title: newColumnTitle.trim(),
            order: columns.length + 1,
        };
        setColumns([...columns, newColumn]);
        setNewColumnTitle("");
    };

    const handleDeleteColumn = (columnId: string) => {
        if (columns.length <= 1) return;
        setColumns(columns.filter(c => c.id !== columnId));
    };

    const handleTitleChange = (columnId: string, title: string) => {
        setColumns(columns.map(c =>
            c.id === columnId ? { ...c, title } : c
        ));
    };

    const handleStatusChange = (columnId: string, status: string) => {
        setColumns(columns.map(c =>
            c.id === columnId
                ? { ...c, status: status === "none" ? undefined : status as "todo" | "in_progress" | "done" | "later" }
                : c
        ));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const currentIds = new Set(columns.map(c => c.id));
            const deletedIds = config.columns
                .filter(c => !currentIds.has(c.id))
                .map(c => c.id);

            for (const id of deletedIds) {
                try {
                    await onDeleteColumn(id);
                } catch {
                    // Ignore if config doesn't exist yet
                }
            }

            await onSave({ ...config, columns });
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to save board settings:", error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Board Settings</DialogTitle>
                    <DialogDescription>Configure custom columns for your Kanban board. Drag to reorder.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                        <span className="w-6"></span>
                        <span className="flex-1">Column Name</span>
                        <span className="w-32 text-center">Auto-set Status</span>
                        <span className="w-8"></span>
                    </div>

                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={columns.map(c => c.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="space-y-2">
                                {columns.map((column) => (
                                    <SortableColumnItem
                                        key={column.id}
                                        column={column}
                                        onTitleChange={handleTitleChange}
                                        onStatusChange={handleStatusChange}
                                        onDelete={handleDeleteColumn}
                                        canDelete={columns.length > 1}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>

                    <div className="flex gap-2 pt-2 border-t">
                        <Input
                            placeholder="New column name..."
                            value={newColumnTitle}
                            onChange={(e) => setNewColumnTitle(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
                            className="h-9"
                        />
                        <Button onClick={handleAddColumn} size="sm" className="h-9">
                            <Plus className="size-4 mr-1" /> Add
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Moving a todo to a column with a status set will automatically update its status.
                    </p>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
