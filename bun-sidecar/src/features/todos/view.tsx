import { useState, useEffect } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, ArrowLeft, Clock } from "lucide-react";
import { Todo } from "./todo-types";

const statusOptions = [
    { value: "todo", label: "To Do", color: "bg-slate-100 text-slate-800" },
    { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-800" },
    { value: "done", label: "Done", color: "bg-green-100 text-green-800" },
    { value: "later", label: "Later", color: "bg-purple-100 text-purple-800" },
];

import { useWorkspaceContext } from "@/contexts/WorkspaceContext";

export function TodosView({ todoId, tabId }: { todoId: string; tabId: string }) {
    // Debug logging to see what props we're receiving
    console.log("TodosView received props:", { todoId, tabId });

    const { closeTab } = useWorkspaceContext();
    const { loading, setLoading } = usePlugin();

    const todosAPI = useTodosAPI();
    const [todo, setTodo] = useState<Todo | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Add defensive check for todoId
        if (!todoId) {
            console.error("TodosView: Missing todoId", { todoId });
            setLoading(false);
            return;
        }

        const loadTodo = async () => {
            setLoading(true);
            try {
                const todoData = await todosAPI.getTodoById({ todoId });
                console.log({ todoData });
                setTodo(todoData);
            } catch (error) {
                console.error("Failed to load todo:", error);
            } finally {
                setLoading(false);
            }
        };

        loadTodo();
    }, [todoId, todosAPI, setLoading]);

    async function saveTodo() {
        if (!todo || !todoId) return;

        setSaving(true);
        try {
            await todosAPI.updateTodo({
                todoId,
                updates: {
                    title: todo.title,
                    description: todo.description,
                    status: todo.status,
                    project: todo.project,
                },
            });
            console.log("Todo saved successfully");
        } catch (error) {
            console.error("Failed to save todo:", error);
        } finally {
            setSaving(false);
        }
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const getStatusBadge = (status: string) => {
        const option = statusOptions.find((opt) => opt.value === status);
        return option ? <Badge className={option.color}>{option.label}</Badge> : null;
    };

    // Early return if todoId is missing
    if (!todoId) {
        return (
            <div className="p-6">
                <div className="text-center py-8">
                    <h2 className="text-xl font-semibold mb-2">Invalid Todo View</h2>
                    <p className="text-muted-foreground mb-4">No todo ID provided for this view.</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6">
                <div className="flex items-center space-x-2 text-muted-foreground">Loading todo...</div>
            </div>
        );
    }

    if (!todo) {
        return (
            <div className="p-6">
                <div className="text-center py-8">
                    <h2 className="text-xl font-semibold mb-2">Todo Not Found</h2>
                    <p className="text-muted-foreground mb-4">The todo "{todoId}" could not be loaded.</p>
                    <Button onClick={() => closeTab(tabId)}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Todos
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                    <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        onClick={() => closeTab(tabId)}
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Todo Details</h1>
                        <p className="text-muted-foreground">Edit and manage your task</p>
                    </div>
                </div>

                <Button onClick={saveTodo} disabled={saving} className="cursor-pointer">
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? "Saving..." : "Save Changes"}
                </Button>
            </div>

            <div className="grid gap-6">
                {/* Basic Information */}
                <Card>
                    <CardHeader>
                        <CardTitle>Basic Information</CardTitle>
                        <CardDescription>Core task details and settings</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="title">Title</Label>
                            <Input
                                id="title"
                                value={todo.title}
                                onChange={(e) => setTodo({ ...todo, title: e.target.value })}
                                placeholder="What needs to be done?"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                                id="description"
                                value={todo.description || ""}
                                onChange={(e) => setTodo({ ...todo, description: e.target.value })}
                                placeholder="Additional details about this task..."
                                rows={4}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="status">Status</Label>
                                <Select
                                    value={todo.status}
                                    onValueChange={(value: "todo" | "in_progress" | "done" | "later") => setTodo({ ...todo, status: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {statusOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="project">Project</Label>
                                <Input
                                    id="project"
                                    value={todo.project || ""}
                                    onChange={(e) => setTodo({ ...todo, project: e.target.value })}
                                    placeholder="Project name"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Status Summary */}
                <Card>
                    <CardHeader>
                        <CardTitle>Status Summary</CardTitle>
                        <CardDescription>Current task status and timeline</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium">Status:</span>
                            {getStatusBadge(todo.status)}
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center space-x-2 text-muted-foreground">
                                <Clock className="w-4 h-4" />
                                <span>Created: {formatDate(todo.createdAt)}</span>
                            </div>
                            <div className="flex items-center space-x-2 text-muted-foreground">
                                <Clock className="w-4 h-4" />
                                <span>Updated: {formatDate(todo.updatedAt)}</span>
                            </div>
                        </div>

                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
