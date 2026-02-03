"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";
import { FileTextIcon, CheckSquareIcon, FolderIcon } from "lucide-react";
import { notesAPI } from "@/hooks/useNotesAPI";
import { todosAPI } from "@/hooks/useTodosAPI";
import { projectsAPI } from "@/hooks/useProjectsAPI";

type FileItem = {
    id: string;
    label: string;
    type: "note" | "todo" | "project";
};

type FilePickerDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (item: FileItem) => void;
};

export function FilePickerDialog({ open, onOpenChange, onSelect }: FilePickerDialogProps) {
    const [notes, setNotes] = useState<FileItem[]>([]);
    const [todos, setTodos] = useState<FileItem[]>([]);
    const [projects, setProjects] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const listRef = useRef<HTMLDivElement>(null);

    // Reset search when dialog opens/closes
    useEffect(() => {
        if (open) {
            setSearch("");
        }
    }, [open]);

    // Reset scroll position when search changes
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = 0;
        }
    }, [search]);

    useEffect(() => {
        if (!open) return;

        const fetchItems = async () => {
            setLoading(true);
            try {
                const [notesData, todosData, projectsData] = await Promise.all([
                    notesAPI.getNotes(),
                    todosAPI.getTodos(),
                    projectsAPI.listProjects(),
                ]);

                setNotes(
                    notesData.map((note) => ({
                        id: `@notes/${note.fileName}`,
                        label: note.fileName.replace(/\.md$/, ""),
                        type: "note" as const,
                    }))
                );

                setTodos(
                    todosData.map((todo) => ({
                        id: `@todos/${todo.id}`,
                        label: todo.title,
                        type: "todo" as const,
                    }))
                );

                setProjects(
                    projectsData.map((project) => ({
                        id: `@projects/${project.name}`,
                        label: project.name,
                        type: "project" as const,
                    }))
                );
            } catch (error) {
                console.error("Failed to fetch items:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchItems();
    }, [open]);

    const handleSelect = useCallback(
        (item: FileItem) => {
            onSelect(item);
            onOpenChange(false);
        },
        [onSelect, onOpenChange]
    );

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Insert Reference"
            description="Search for notes and todos to reference"
        >
            <CommandInput
                placeholder="Search notes, todos and projects..."
                value={search}
                onValueChange={setSearch}
            />
            <CommandList ref={listRef}>
                {loading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                        Loading...
                    </div>
                ) : (
                    <>
                        <CommandEmpty>No results found.</CommandEmpty>

                        {notes.length > 0 && (
                            <CommandGroup heading="Notes">
                                {notes.map((note) => (
                                    <CommandItem
                                        key={note.id}
                                        value={`${note.label} ${note.id}`}
                                        onSelect={() => handleSelect(note)}
                                    >
                                        <FileTextIcon className="text-blue-500" />
                                        <span>{note.label}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )}

                        {todos.length > 0 && (
                            <CommandGroup heading="Todos">
                                {todos.map((todo) => (
                                    <CommandItem
                                        key={todo.id}
                                        value={`${todo.label} ${todo.id}`}
                                        onSelect={() => handleSelect(todo)}
                                    >
                                        <CheckSquareIcon className="text-amber-500" />
                                        <span>{todo.label}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )}

                        {projects.length > 0 && (
                            <CommandGroup heading="Projects">
                                {projects.map((project) => (
                                    <CommandItem
                                        key={project.id}
                                        value={`${project.label} ${project.id}`}
                                        onSelect={() => handleSelect(project)}
                                    >
                                        <FolderIcon className="text-purple-500" />
                                        <span>{project.label}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )}
                    </>
                )}
            </CommandList>
        </CommandDialog>
    );
}
