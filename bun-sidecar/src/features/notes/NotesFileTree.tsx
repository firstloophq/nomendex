import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
    ChevronRight,
    ChevronDown,
    Folder as FolderIcon,
    FolderOpen,
    FolderPlus,
    FilePlus,
    MoreHorizontal,
    Pencil,
    Trash2,
    FileText,
    FolderInput,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { OverlayScrollbar } from "@/components/OverlayScrollbar";
import { useTheme } from "@/hooks/useTheme";
import { NoteFolder, Note } from "./index";
import { cn } from "@/lib/utils";

interface NotesFileTreeProps {
    folders: NoteFolder[];
    notes: Note[];
    selectedNoteFileName: string | null;
    onSelectNote: (note: Note) => void;
    onOpenNote: (noteFileName: string) => void;
    onDeleteNote: (noteFileName: string) => void;
    onCreateFolder: (parentPath: string | null) => void;
    onCreateNoteInFolder: (folderPath: string | null) => void;
    onRenameFolder: (folder: NoteFolder) => void;
    onDeleteFolder: (folder: NoteFolder) => void;
    onMoveToFolder: (note: Note) => void;
    onPreloadNote?: (noteFileName: string) => void;
    searchQuery?: string;
}

interface TreeNode {
    type: "folder" | "note";
    name: string;
    path: string;
    folder?: NoteFolder;
    note?: Note;
    children: TreeNode[];
}

// Helper: Extract first H1 heading from content
function extractTitle(content: string): string | null {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();
    const h2Match = content.match(/^##\s+(.+)$/m);
    if (h2Match) return h2Match[1].trim();
    return null;
}

// Helper: Format filename to display name
function formatDisplayName(fileName: string): string {
    return fileName.replace(/\.md$/, "");
}

function buildFileTree(folders: NoteFolder[], notes: Note[]): TreeNode[] {
    // Create folder nodes map
    const folderMap = new Map<string, TreeNode>();

    // Sort folders by path depth (parents first)
    const sortedFolders = [...folders].sort(
        (a, b) => a.path.split("/").length - b.path.split("/").length
    );

    // Build folder nodes
    sortedFolders.forEach((folder) => {
        const node: TreeNode = {
            type: "folder",
            name: folder.name,
            path: folder.path,
            folder,
            children: [],
        };
        folderMap.set(folder.path, node);
    });

    // Build tree structure for folders
    const rootNodes: TreeNode[] = [];
    sortedFolders.forEach((folder) => {
        const node = folderMap.get(folder.path);
        if (!node) return;

        const parentPath = folder.path.includes("/")
            ? folder.path.substring(0, folder.path.lastIndexOf("/"))
            : null;

        if (parentPath && folderMap.has(parentPath)) {
            folderMap.get(parentPath)?.children.push(node);
        } else {
            rootNodes.push(node);
        }
    });

    // Add notes to appropriate folders or root
    notes.forEach((note) => {
        const noteNode: TreeNode = {
            type: "note",
            name: note.fileName,
            path: note.folderPath
                ? `${note.folderPath}/${note.fileName}`
                : note.fileName,
            note,
            children: [],
        };

        if (note.folderPath && folderMap.has(note.folderPath)) {
            folderMap.get(note.folderPath)?.children.push(noteNode);
        } else {
            rootNodes.push(noteNode);
        }
    });

    // Sort children: folders first, then notes, both alphabetically
    const sortChildren = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "folder" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        nodes.forEach((node) => {
            if (node.children.length > 0) {
                sortChildren(node.children);
            }
        });
    };
    sortChildren(rootNodes);

    return rootNodes;
}

// Flatten visible notes from tree (respecting expanded folders)
function flattenVisibleNotes(
    nodes: TreeNode[],
    expandedFolders: Set<string>
): Note[] {
    const result: Note[] = [];

    const traverse = (nodeList: TreeNode[]) => {
        for (const node of nodeList) {
            if (node.type === "note" && node.note) {
                result.push(node.note);
            } else if (node.type === "folder") {
                if (expandedFolders.has(node.path)) {
                    traverse(node.children);
                }
            }
        }
    };

    traverse(nodes);
    return result;
}

function TreeItem({
    node,
    depth,
    selectedNoteFileName,
    expandedFolders,
    onToggleExpand,
    onSelectNote,
    onOpenNote,
    onDeleteNote,
    onCreateFolder,
    onCreateNoteInFolder,
    onRenameFolder,
    onDeleteFolder,
    onMoveToFolder,
    rowRefs,
}: {
    node: TreeNode;
    depth: number;
    selectedNoteFileName: string | null;
    expandedFolders: Set<string>;
    onToggleExpand: (folderPath: string) => void;
    onSelectNote: (note: Note) => void;
    onOpenNote: (noteFileName: string) => void;
    onDeleteNote: (noteFileName: string) => void;
    onCreateFolder: (parentPath: string | null) => void;
    onCreateNoteInFolder: (folderPath: string | null) => void;
    onRenameFolder: (folder: NoteFolder) => void;
    onDeleteFolder: (folder: NoteFolder) => void;
    onMoveToFolder: (note: Note) => void;
    rowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}) {
    const { currentTheme } = useTheme();

    if (node.type === "folder") {
        const isExpanded = expandedFolders.has(node.path);
        const hasChildren = node.children.length > 0;

        return (
            <div>
                <div
                    className={cn(
                        "flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer group"
                    )}
                    style={{
                        paddingLeft: `${depth * 16 + 8}px`,
                    }}
                    onClick={() => onToggleExpand(node.path)}
                >
                    <button
                        type="button"
                        className="p-0.5 rounded shrink-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand(node.path);
                        }}
                    >
                        {isExpanded ? (
                            <ChevronDown
                                className="size-3.5"
                                style={{ color: currentTheme.styles.contentSecondary }}
                            />
                        ) : (
                            <ChevronRight
                                className="size-3.5"
                                style={{
                                    color: currentTheme.styles.contentSecondary,
                                    visibility: hasChildren ? "visible" : "hidden",
                                }}
                            />
                        )}
                    </button>
                    {isExpanded ? (
                        <FolderOpen
                            className="size-4 shrink-0"
                            style={{ color: currentTheme.styles.contentSecondary }}
                        />
                    ) : (
                        <FolderIcon
                            className="size-4 shrink-0"
                            style={{ color: currentTheme.styles.contentSecondary }}
                        />
                    )}
                    <span
                        className="flex-1 truncate text-sm"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        {node.name}
                    </span>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="p-0.5 hover:bg-muted rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreHorizontal
                                    className="size-3.5"
                                    style={{ color: currentTheme.styles.contentSecondary }}
                                />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            style={{
                                backgroundColor: currentTheme.styles.surfacePrimary,
                                borderColor: currentTheme.styles.borderDefault,
                            }}
                        >
                            <DropdownMenuItem
                                onClick={() => onCreateNoteInFolder(node.path)}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <FilePlus className="size-4 mr-2" />
                                New Note
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onCreateFolder(node.path)}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <FolderPlus className="size-4 mr-2" />
                                New Subfolder
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => node.folder && onRenameFolder(node.folder)}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <Pencil className="size-4 mr-2" />
                                Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => node.folder && onDeleteFolder(node.folder)}
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                <Trash2 className="size-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                {isExpanded &&
                    node.children.map((child) => (
                        <TreeItem
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            selectedNoteFileName={selectedNoteFileName}
                            expandedFolders={expandedFolders}
                            onToggleExpand={onToggleExpand}
                            onSelectNote={onSelectNote}
                            onOpenNote={onOpenNote}
                            onDeleteNote={onDeleteNote}
                            onCreateFolder={onCreateFolder}
                            onCreateNoteInFolder={onCreateNoteInFolder}
                            onRenameFolder={onRenameFolder}
                            onDeleteFolder={onDeleteFolder}
                            onMoveToFolder={onMoveToFolder}
                            rowRefs={rowRefs}
                        />
                    ))}
            </div>
        );
    }

    // Note item
    const note = node.note!;
    const isSelected = selectedNoteFileName === note.fileName;
    const h1Title = extractTitle(note.content || "");
    const displayName = formatDisplayName(note.fileName);
    const displayTitle = h1Title || displayName;

    return (
        <div
            ref={(el) => {
                if (el) {
                    rowRefs.current.set(note.fileName, el);
                } else {
                    rowRefs.current.delete(note.fileName);
                }
            }}
            className={cn(
                "flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer group"
            )}
            style={{
                paddingLeft: `${depth * 16 + 8}px`,
                backgroundColor: isSelected
                    ? currentTheme.styles.surfaceSecondary
                    : undefined,
                border: isSelected
                    ? `1px solid ${currentTheme.styles.contentAccent}`
                    : "1px solid transparent",
            }}
            onClick={() => onSelectNote(note)}
            onDoubleClick={() => onOpenNote(note.fileName)}
        >
            <div className="w-4 shrink-0" /> {/* Spacer for alignment */}
            <FileText
                className="size-4 shrink-0"
                style={{ color: currentTheme.styles.contentSecondary }}
            />
            <span
                className="flex-1 truncate text-sm"
                style={{ color: currentTheme.styles.contentPrimary }}
            >
                {displayTitle}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    type="button"
                    className="p-0.5 hover:bg-muted rounded"
                    onClick={(e) => {
                        e.stopPropagation();
                        onMoveToFolder(note);
                    }}
                    title="Move to folder"
                >
                    <FolderInput
                        className="size-3.5"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    />
                </button>
                <button
                    type="button"
                    className="p-0.5 hover:bg-muted rounded"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNote(note.fileName);
                    }}
                    title="Delete note"
                >
                    <Trash2
                        className="size-3.5"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    />
                </button>
            </div>
        </div>
    );
}

export function NotesFileTree({
    folders,
    notes,
    selectedNoteFileName,
    onSelectNote,
    onOpenNote,
    onDeleteNote,
    onCreateFolder,
    onCreateNoteInFolder,
    onRenameFolder,
    onDeleteFolder,
    onMoveToFolder,
    onPreloadNote,
    searchQuery,
}: NotesFileTreeProps) {
    const { currentTheme } = useTheme();
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
        () => new Set(folders.map((f) => f.path)) // Start with all expanded
    );

    // Refs for keyboard navigation
    const containerRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const selectedIndexRef = useRef(0);
    const repeatDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const heldKeysRef = useRef<Set<string>>(new Set());
    const visibleNotesRef = useRef<Note[]>([]);
    const onOpenNoteRef = useRef(onOpenNote);

    // Filter notes by search query
    const filteredNotes = useMemo(() => {
        if (!searchQuery?.trim()) return notes;
        const query = searchQuery.toLowerCase();
        return notes.filter((note) => {
            const title = extractTitle(note.content || "") || note.fileName;
            return (
                note.fileName.toLowerCase().includes(query) ||
                title.toLowerCase().includes(query)
            );
        });
    }, [notes, searchQuery]);

    // Build tree from folders and filtered notes
    const tree = useMemo(
        () => buildFileTree(folders, filteredNotes),
        [folders, filteredNotes]
    );

    // Get flat list of visible notes for keyboard navigation
    const visibleNotes = useMemo(
        () => flattenVisibleNotes(tree, expandedFolders),
        [tree, expandedFolders]
    );

    // Keep refs in sync (avoids effect re-runs during navigation)
    visibleNotesRef.current = visibleNotes;
    onOpenNoteRef.current = onOpenNote;

    // Keep selectedIndexRef in sync with selection
    useEffect(() => {
        if (selectedNoteFileName) {
            const index = visibleNotes.findIndex(
                (n) => n.fileName === selectedNoteFileName
            );
            if (index !== -1) {
                selectedIndexRef.current = index;
            }
        }
    }, [selectedNoteFileName, visibleNotes]);

    const toggleExpand = useCallback((folderPath: string) => {
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderPath)) {
                next.delete(folderPath);
            } else {
                next.add(folderPath);
            }
            return next;
        });
    }, []);

    // Auto-expand folders when searching
    useEffect(() => {
        if (searchQuery?.trim()) {
            // When searching, expand all folders that contain matching notes
            const foldersWithMatches = new Set<string>();
            filteredNotes.forEach((note) => {
                if (note.folderPath) {
                    // Add the folder and all parent folders
                    const parts = note.folderPath.split("/");
                    let path = "";
                    parts.forEach((part, i) => {
                        path = i === 0 ? part : `${path}/${part}`;
                        foldersWithMatches.add(path);
                    });
                }
            });
            setExpandedFolders(foldersWithMatches);
        }
    }, [searchQuery, filteredNotes]);

    // Navigation functions
    const updateSelection = useCallback(
        (newIndex: number) => {
            if (newIndex < 0 || newIndex >= visibleNotes.length) return;
            selectedIndexRef.current = newIndex;
            const note = visibleNotes[newIndex];
            if (note) {
                onSelectNote(note);

                // Scroll into view
                const el = rowRefs.current.get(note.fileName);
                el?.scrollIntoView({ block: "nearest", behavior: "instant" });

                // Preload adjacent notes for smoother navigation
                if (onPreloadNote) {
                    if (newIndex > 0) {
                        onPreloadNote(visibleNotes[newIndex - 1].fileName);
                    }
                    if (newIndex < visibleNotes.length - 1) {
                        onPreloadNote(visibleNotes[newIndex + 1].fileName);
                    }
                }
            }
        },
        [visibleNotes, onSelectNote, onPreloadNote]
    );

    const navigateDown = useCallback(() => {
        const current = selectedIndexRef.current;
        if (current < visibleNotes.length - 1) {
            updateSelection(current + 1);
        }
    }, [visibleNotes.length, updateSelection]);

    const navigateUp = useCallback(() => {
        const current = selectedIndexRef.current;
        if (current > 0) {
            updateSelection(current - 1);
        }
    }, [updateSelection]);

    const stopRepeat = useCallback(() => {
        if (repeatDelayRef.current) {
            clearTimeout(repeatDelayRef.current);
            repeatDelayRef.current = null;
        }
        if (repeatIntervalRef.current) {
            clearInterval(repeatIntervalRef.current);
            repeatIntervalRef.current = null;
        }
    }, []);

    const startRepeat = useCallback(
        (direction: "up" | "down") => {
            stopRepeat();
            const navigate = direction === "down" ? navigateDown : navigateUp;
            // Wait 300ms before starting repeat (standard keyboard delay)
            repeatDelayRef.current = setTimeout(() => {
                // 60ms = ~16 items per second, smooth but not too fast
                repeatIntervalRef.current = setInterval(navigate, 60);
            }, 300);
        },
        [navigateDown, navigateUp, stopRepeat]
    );

    // Clean up on unmount
    useEffect(() => {
        const heldKeys = heldKeysRef.current;
        return () => {
            stopRepeat();
            heldKeys.clear();
        };
    }, [stopRepeat]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Skip if a dialog is open (let the dialog handle its own keys)
            if (document.querySelector('[role="dialog"]')) return;

            // Handle Enter key to open selected note
            if (e.key === "Enter") {
                // Only handle if we're in the file tree area or search input
                if (!containerRef.current?.contains(document.activeElement) &&
                    document.activeElement?.tagName !== "INPUT") return;

                // Don't handle if focus is on a button (let the button handle it)
                if (document.activeElement?.tagName === "BUTTON") return;

                const currentNote = visibleNotesRef.current[selectedIndexRef.current];
                if (currentNote) {
                    e.preventDefault();
                    onOpenNoteRef.current(currentNote.fileName);
                }
                return;
            }

            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

            // Only handle if we're in the file tree area
            if (!containerRef.current?.contains(document.activeElement) &&
                document.activeElement?.tagName !== "INPUT") return;

            // Always prevent default to stop native behavior
            e.preventDefault();

            // Ignore if this key is already held (native repeat event)
            if (heldKeysRef.current.has(e.key)) return;

            // Mark key as held
            heldKeysRef.current.add(e.key);

            if (visibleNotesRef.current.length === 0) return;

            // Immediate first move + start repeat after initial delay
            if (e.key === "ArrowDown") {
                navigateDown();
                startRepeat("down");
            } else {
                navigateUp();
                startRepeat("up");
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                heldKeysRef.current.delete(e.key);
                stopRepeat();
            }
        };

        const handleBlur = () => {
            heldKeysRef.current.clear();
            stopRepeat();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, [navigateDown, navigateUp, startRepeat, stopRepeat]);

    const noteCount = filteredNotes.length;
    const hasNoResults = searchQuery?.trim() && noteCount === 0;

    return (
        <div className="flex flex-col h-full" ref={containerRef} tabIndex={-1}>
            <OverlayScrollbar className="flex-1 py-1">
                {hasNoResults ? (
                    <div
                        className="p-4 text-center text-sm"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    >
                        No notes match "{searchQuery}"
                    </div>
                ) : tree.length === 0 ? (
                    <div
                        className="p-4 text-center"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    >
                        <FileText
                            className="h-8 w-8 mx-auto mb-2"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        />
                        <p className="text-sm">No notes yet</p>
                    </div>
                ) : (
                    tree.map((node) => (
                        <TreeItem
                            key={node.path}
                            node={node}
                            depth={0}
                            selectedNoteFileName={selectedNoteFileName}
                            expandedFolders={expandedFolders}
                            onToggleExpand={toggleExpand}
                            onSelectNote={onSelectNote}
                            onOpenNote={onOpenNote}
                            onDeleteNote={onDeleteNote}
                            onCreateFolder={onCreateFolder}
                            onCreateNoteInFolder={onCreateNoteInFolder}
                            onRenameFolder={onRenameFolder}
                            onDeleteFolder={onDeleteFolder}
                            onMoveToFolder={onMoveToFolder}
                            rowRefs={rowRefs}
                        />
                    ))
                )}
            </OverlayScrollbar>
        </div>
    );
}
