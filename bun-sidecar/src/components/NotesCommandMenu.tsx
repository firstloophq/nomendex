import * as React from "react";
import { FileText } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { Note, notesPluginSerial } from "@/features/notes";

export function NotesCommandMenu() {
    const [open, setOpen] = React.useState(false);
    const { openTab } = useWorkspaceContext();
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [notes, setNotes] = React.useState<Note[]>([]);
    const [loading, setLoading] = React.useState(false);

    // Create the API once
    const call = useNotesAPI();

    // Keyboard shortcut handler - CMD+P
    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    // Focus input when dialog opens
    React.useEffect(() => {
        if (open) {
            // Next tick to ensure input exists
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [open]);

    // Load notes when dialog opens
    React.useEffect(() => {
        const fetchNotes = async () => {
            if (open) {
                console.log("[NotesCommandMenu] Dialog opened, fetching notes...");
                setLoading(true);
                const result = await call.getNotes();
                setNotes(result);
                setLoading(false);
            } else {
                // Clear notes when dialog closes to ensure fresh data next time
                setNotes([]);
            }
        };

        fetchNotes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]); // call is intentionally omitted since it's memoized

    const handleSelectNote = (fileName: string) => {
        console.log("[NotesCommandMenu] Selecting note:", fileName);

        // Open tab (or focus existing one) with the notes editor view
        const tab = openTab({
            pluginMeta: notesPluginSerial,
            view: "editor",
            props: { noteFileName: fileName },
        });

        if (tab) {
            console.log("[NotesCommandMenu] Opened tab:", tab);
        } else {
            console.error("[NotesCommandMenu] Failed to open tab for note:", fileName);
        }

        setOpen(false);
    };

    // Sort notes with most recent first
    const sortedNotes = React.useMemo(() => {
        return [...notes].sort((a, b) => {
            // Extract dates from filenames if they match daily note format (YYYY-MM-DD.md)
            const dateRegex = /^\d{4}-\d{2}-\d{2}\.md$/;
            const aIsDaily = dateRegex.test(a.fileName);
            const bIsDaily = dateRegex.test(b.fileName);

            // Daily notes first, sorted by date descending
            if (aIsDaily && bIsDaily) {
                return b.fileName.localeCompare(a.fileName);
            }
            if (aIsDaily) return -1;
            if (bIsDaily) return 1;

            // Other notes alphabetically
            return a.fileName.localeCompare(b.fileName);
        });
    }, [notes]);

    // Remove the render log as it can cause issues

    return (
        <CommandDialog open={open} onOpenChange={setOpen}>
            <CommandInput ref={inputRef} placeholder="Search notes..." />
            <CommandList>
                {loading ? <CommandEmpty>Loading notes...</CommandEmpty> : notes.length === 0 ? <CommandEmpty>No notes found.</CommandEmpty> : null}

                {/* Notes List */}
                {sortedNotes.length > 0 && (
                    <CommandGroup heading="Notes">
                        {sortedNotes.map((note) => {
                            // Check if it's a daily note
                            const dateRegex = /^(\d{4}-\d{2}-\d{2})\.md$/;
                            const match = note.fileName.match(dateRegex);
                            const isDaily = !!match;
                            const displayName = isDaily ? `Daily Note - ${match![1]}` : note.fileName.replace(".md", "");

                            return (
                                <CommandItem key={note.fileName} onSelect={() => handleSelectNote(note.fileName)}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    <span>{displayName}</span>
                                    {isDaily && <span className="ml-auto text-xs text-muted-foreground">Daily</span>}
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>
                )}
            </CommandList>
        </CommandDialog>
    );
}
