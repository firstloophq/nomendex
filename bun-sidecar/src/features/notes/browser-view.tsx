import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, FileText, FilePlus, FolderPlus, Maximize2 } from "lucide-react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { Note, NoteFolder, notesPluginSerial } from "./index";
import { useTheme } from "@/hooks/useTheme";
import { NotesView } from "./note-view";
import { NotesFileTree } from "./NotesFileTree";
import { CreateFolderDialog, RenameFolderDialog, MoveToFolderDialog } from "./NotesFolderDialogs";
import { toast } from "sonner";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { CreateNoteDialog } from "./create-note-dialog";
import { DeleteNoteDialog } from "./delete-note-dialog";
import { DeleteFolderDialog } from "./delete-folder-dialog";

export function NotesBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId, showHiddenFiles } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [notes, setNotes] = useState<Array<Note>>([]);
    const [folders, setFolders] = useState<NoteFolder[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedNote, setSelectedNote] = useState<Note | null>(null);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [newNoteName, setNewNoteName] = useState("");
    const [createNoteInFolderPath, setCreateNoteInFolderPath] = useState<string | null>(null);
    const placement = getViewSelfPlacement(tabId);
    const { currentTheme } = useTheme();
    const { openDialog } = useCommandDialog();

    // Folder dialog state
    const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
    const [createFolderParentPath, setCreateFolderParentPath] = useState<string | null>(null);
    const [renameFolderDialogOpen, setRenameFolderDialogOpen] = useState(false);
    const [folderToRename, setFolderToRename] = useState<NoteFolder | null>(null);
    const [moveToFolderDialogOpen, setMoveToFolderDialogOpen] = useState(false);
    const [noteToMove, setNoteToMove] = useState<Note | null>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const hasSetTabNameRef = useRef<boolean>(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // API hook
    const notesAPI = useNotesAPI();

    // Set tab name for browser view - only once when component mounts
    useEffect(() => {
        if (
            activeTab &&
            activeTab.pluginInstance.plugin.id === "notes" &&
            activeTab.pluginInstance.viewId !== "editor" &&
            !hasSetTabNameRef.current
        ) {
            setTabName(activeTab.id, "Notes Browse");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, setTabName]);

    // Auto-focus search input when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId && !loading) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, loading]);

    const loadFolders = useCallback(async () => {
        try {
            const foldersResult = await notesAPI.getFolders({ showHiddenFiles });
            setFolders(foldersResult);
        } catch (err) {
            console.error("Failed to load folders:", err);
        }
    }, [notesAPI, showHiddenFiles]);

    useEffect(() => {
        const fetchNotes = async () => {
            try {
                setLoading(true);
                setError(null);
                const [notesResult] = await Promise.all([
                    notesAPI.getNotes({ showHiddenFiles }),
                    loadFolders(),
                ]);
                setNotes(notesResult);

                if (notesResult.length > 0 && !selectedNote) {
                    const sortedNotes = notesResult.sort((a, b) => a.fileName.localeCompare(b.fileName));
                    setSelectedNote(sortedNotes[0] || null);
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch notes";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };
        fetchNotes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [notesAPI, setLoading, setError, loadFolders, showHiddenFiles]);

    const handleCreateNote = async () => {
        const finalNoteId = newNoteName.trim();
        if (!finalNoteId) return;

        try {
            setLoading(true);
            await notesAPI.saveNote({ fileName: finalNoteId, content: `# ${finalNoteId}\n\n` });

            // If creating in a folder, move the note there
            if (createNoteInFolderPath) {
                await notesAPI.moveNoteToFolder({ fileName: finalNoteId, targetFolder: createNoteInFolderPath });
            }

            const result = await notesAPI.getNotes({ showHiddenFiles });
            setNotes(result);

            setCreateDialogOpen(false);
            setNewNoteName("");
            setCreateNoteInFolderPath(null);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create note";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateNoteInFolder = useCallback((folderPath: string | null) => {
        setCreateNoteInFolderPath(folderPath);
        setCreateDialogOpen(true);
    }, []);

    const handleOpenNote = useCallback(
        async (noteId: string) => {
            const newTab = await addNewTab({
                pluginMeta: notesPluginSerial,
                view: "editor",
                props: { noteFileName: noteId },
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, setActiveTabId, placement, setSidebarTabId]
    );

    const requestDeleteNote = useCallback((noteFileName: string) => {
        openDialog({
            content: (
                <DeleteNoteDialog
                    noteFileName={noteFileName}
                    onSuccess={() => {
                        // Refresh notes list after deletion
                        notesAPI.getNotes({ showHiddenFiles }).then(result => {
                            setNotes(result);
                            if (selectedNote?.fileName === noteFileName) {
                                setSelectedNote(result[0] || null);
                            }
                        });
                    }}
                />
            ),
        });
    }, [openDialog, notesAPI, selectedNote]);

    const handleSelectNote = useCallback((note: Note) => {
        setSelectedNote(note);
    }, []);

    // Folder handlers
    const handleCreateFolder = useCallback((parentPath: string | null) => {
        setCreateFolderParentPath(parentPath);
        setCreateFolderDialogOpen(true);
    }, []);

    const handleRenameFolder = useCallback((folder: NoteFolder) => {
        setFolderToRename(folder);
        setRenameFolderDialogOpen(true);
    }, []);

    const handleDeleteFolder = useCallback((folder: NoteFolder) => {
        openDialog({
            content: (
                <DeleteFolderDialog
                    folderName={folder.name}
                    onDelete={async () => {
                        await notesAPI.deleteFolder({ folderPath: folder.path });
                        toast.success(`Deleted folder "${folder.name}"`);
                        await loadFolders();
                        const result = await notesAPI.getNotes({ showHiddenFiles });
                        setNotes(result);
                    }}
                />
            ),
        });
    }, [openDialog, notesAPI, loadFolders]);

    const handleFolderCreate = useCallback(async (name: string, parentPath: string | null) => {
        try {
            await notesAPI.createFolder({ name, parentPath: parentPath ?? undefined });
            toast.success(`Created folder "${name}"`);
            await loadFolders();
        } catch (err) {
            console.error("Failed to create folder:", err);
            toast.error("Failed to create folder");
        }
    }, [notesAPI, loadFolders]);

    const handleFolderRename = useCallback(async (oldPath: string, newName: string) => {
        try {
            await notesAPI.renameFolder({ oldPath, newName });
            toast.success(`Renamed folder to "${newName}"`);
            await loadFolders();
            const notesResult = await notesAPI.getNotes({ showHiddenFiles });
            setNotes(notesResult);
        } catch (err) {
            console.error("Failed to rename folder:", err);
            toast.error("Failed to rename folder");
        }
    }, [notesAPI, loadFolders, showHiddenFiles]);

    const handleMoveToFolder = useCallback((note: Note) => {
        setNoteToMove(note);
        setMoveToFolderDialogOpen(true);
    }, []);

    const handleMoveNoteToFolder = useCallback(async (fileName: string, targetFolder: string | null) => {
        try {
            await notesAPI.moveNoteToFolder({ fileName, targetFolder });
            const folderName = targetFolder ? folders.find(f => f.path === targetFolder)?.name ?? "folder" : "root";
            toast.success(`Moved to ${folderName}`);
            const result = await notesAPI.getNotes({ showHiddenFiles });
            setNotes(result);
        } catch (err) {
            console.error("Failed to move note:", err);
            toast.error("Failed to move note");
        }
    }, [notesAPI, folders, showHiddenFiles]);

    // Get parent folder name for create dialog
    const createFolderParentName = createFolderParentPath
        ? folders.find(f => f.path === createFolderParentPath)?.name
        : undefined;

    // Register keyboard shortcuts
    useKeyboardShortcuts(
        [
            {
                id: "notes.search",
                name: "Focus Search",
                combo: { key: "/" },
                handler: () => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                },
                category: "Navigation",
                priority: 10,
            },
            {
                id: "notes.open",
                name: "Open Note",
                combo: { key: "Enter" },
                handler: () => {
                    if (selectedNote && document.activeElement !== searchInputRef.current) {
                        handleOpenNote(selectedNote.fileName);
                    }
                },
                when: () => selectedNote !== null && document.activeElement !== searchInputRef.current,
                category: "Actions",
            },
            {
                id: "notes.create",
                name: "Create Note",
                combo: { key: "n", cmd: true },
                handler: () => {
                    setCreateDialogOpen(true);
                },
                category: "Actions",
                priority: 20,
            },
            {
                id: "notes.delete",
                name: "Delete Note",
                combo: { key: "Backspace", cmd: true },
                handler: () => {
                    if (selectedNote) {
                        requestDeleteNote(selectedNote.fileName);
                    }
                },
                when: () => selectedNote !== null,
                category: "Actions",
                priority: 15,
            },
            {
                id: "notes.escape-search",
                name: "Clear Search",
                combo: { key: "Escape" },
                handler: () => {
                    if (document.activeElement === searchInputRef.current && searchQuery) {
                        setSearchQuery("");
                        return true;
                    }
                    if (document.activeElement === searchInputRef.current) {
                        searchInputRef.current?.blur();
                        return true;
                    }
                    return false;
                },
                category: "Navigation",
            },
        ],
        {
            context: "plugin:notes",
            onlyWhenActive: true,
            deps: [selectedNote, searchQuery, handleOpenNote, requestDeleteNote],
        }
    );

    return (
        <div className="h-full flex flex-col" ref={containerRef} tabIndex={-1}>
            {/* Create Note Dialog */}
            <Dialog open={createDialogOpen} onOpenChange={(open) => {
                setCreateDialogOpen(open);
                if (!open) {
                    setNewNoteName("");
                    setCreateNoteInFolderPath(null);
                }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {createNoteInFolderPath
                                ? `New Note in "${folders.find(f => f.path === createNoteInFolderPath)?.name ?? createNoteInFolderPath}"`
                                : "Create New Note"
                            }
                        </DialogTitle>
                        <DialogDescription>Enter a name for your new note</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="note-name">Note Name</Label>
                            <Input
                                id="note-name"
                                value={newNoteName}
                                onChange={(e) => setNewNoteName(e.target.value)}
                                placeholder="My New Note"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleCreateNote();
                                    }
                                }}
                                autoFocus
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setCreateDialogOpen(false);
                                setNewNoteName("");
                                setCreateNoteInFolderPath(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleCreateNote} disabled={!newNoteName.trim()}>
                            Create Note
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Main Content - Split Layout */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - File Tree */}
                <div className="w-64 border-r flex flex-col h-full" style={{ borderColor: currentTheme.styles.borderDefault }}>
                    {/* Search and Create */}
                    <div className="px-3 py-3 border-b space-y-2" style={{ borderColor: currentTheme.styles.borderDefault }}>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1 min-w-0">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: currentTheme.styles.contentSecondary }} />
                                <Input
                                    ref={searchInputRef}
                                    placeholder="Search notes..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Escape") {
                                            if (searchQuery) {
                                                e.preventDefault();
                                                setSearchQuery("");
                                            } else {
                                                searchInputRef.current?.blur();
                                            }
                                        }
                                    }}
                                    className="pl-7"
                                    autoFocus
                                />
                            </div>
                            <div className="flex items-center">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                    openDialog({
                                        title: "Create New Note",
                                        description: "Enter a name for your new note",
                                        content: <CreateNoteDialog />,
                                    });
                                }} title="New note">
                                    <FilePlus className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCreateFolder(null)} title="New folder">
                                    <FolderPlus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {error && (
                            <Alert variant="destructive" className="mt-2">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                    </div>

                    {/* File Tree */}
                    <div className="flex-1 overflow-hidden">
                        <NotesFileTree
                            folders={folders}
                            notes={notes}
                            selectedNoteFileName={selectedNote?.fileName ?? null}
                            onSelectNote={handleSelectNote}
                            onOpenNote={handleOpenNote}
                            onDeleteNote={requestDeleteNote}
                            onCreateFolder={handleCreateFolder}
                            onCreateNoteInFolder={handleCreateNoteInFolder}
                            onRenameFolder={handleRenameFolder}
                            onDeleteFolder={handleDeleteFolder}
                            onMoveToFolder={handleMoveToFolder}
                            onPreloadNote={notesAPI.preloadNote}
                            searchQuery={searchQuery}
                        />
                    </div>
                </div>

                {/* Right Panel - Editor */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {selectedNote ? (
                        <>
                            {/* Focus button - opens note in dedicated tab */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 z-20 h-8 w-8"
                                onClick={() => handleOpenNote(selectedNote.fileName)}
                                title="Focus note in new tab"
                            >
                                <Maximize2 className="h-4 w-4" />
                            </Button>
                            <div className="flex-1 overflow-hidden">
                                <NotesView
                                    noteFileName={selectedNote.fileName}
                                    tabId={tabId}
                                    autoFocus={false}
                                    compact={true}
                                />
                            </div>
                        </>
                    ) : !loading && notes.length > 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center space-y-2">
                                <FileText className="h-12 w-12 mx-auto" style={{ color: currentTheme.styles.contentTertiary }} />
                                <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>Select a note to edit</p>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Folder Dialogs */}
            <CreateFolderDialog
                open={createFolderDialogOpen}
                onOpenChange={setCreateFolderDialogOpen}
                parentPath={createFolderParentPath}
                parentName={createFolderParentName}
                onCreate={handleFolderCreate}
            />
            <RenameFolderDialog
                open={renameFolderDialogOpen}
                onOpenChange={setRenameFolderDialogOpen}
                folder={folderToRename}
                onRename={handleFolderRename}
            />
            <MoveToFolderDialog
                open={moveToFolderDialogOpen}
                onOpenChange={setMoveToFolderDialogOpen}
                note={noteToMove}
                folders={folders}
                onMove={handleMoveNoteToFolder}
            />
        </div>
    );
}

export default NotesBrowserView;
