import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { BoardConfig, BoardColumn } from "./board-types";

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

    const [prevOpen, setPrevOpen] = useState(open);
    if (open !== prevOpen) {
        setPrevOpen(open);
        if (open) {
            setColumns(config.columns);
        }
    }

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
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                        <span className="flex-1">Column Name</span>
                        <span className="w-32 text-center">Auto-set Status</span>
                        <span className="w-8"></span>
                    </div>

                    <div className="space-y-2">
                        {columns.map((column) => (
                            <div key={column.id} className="flex items-center gap-2 bg-muted/40 p-2 rounded-md">
                                <GripVertical className="size-4 text-muted-foreground shrink-0" />
                                <Input
                                    value={column.title}
                                    onChange={(e) => {
                                        setColumns(columns.map(c =>
                                            c.id === column.id
                                                ? { ...c, title: e.target.value }
                                                : c
                                        ));
                                    }}
                                    className="h-8 flex-1"
                                />
                                <Select
                                    value={column.status || "none"}
                                    onValueChange={(value) => handleStatusChange(column.id, value)}
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
                                    onClick={() => handleDeleteColumn(column.id)}
                                    disabled={columns.length <= 1}
                                    className="h-8 w-8 p-0 shrink-0"
                                >
                                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                                </Button>
                            </div>
                        ))}
                    </div>

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
