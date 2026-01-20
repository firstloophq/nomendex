import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { todosAPI } from "@/hooks/useTodosAPI";
import { EditorState, Selection, NodeSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { exampleSetup } from "prosemirror-example-setup";
import { sinkListItem, liftListItem, wrapInList } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";
import { chainCommands } from "prosemirror-commands";
import { todoKeymap, todoPlugin } from "./simple-todo";
import {
    tableSchema,
    tableMarkdownParser,
    tableMarkdownSerializer,
    getTablePlugins,
    fixTables,
    normalizeTableColumns,
} from "@/components/prosemirror/tables";
import {
    createWikiLinkPlugin,
    WikiLinkPopup,
    type WikiLinkPluginState,
} from "@/components/prosemirror/wiki-links";
import "@/components/prosemirror/wiki-links/wiki-links.css";
import {
    createTagLinkPlugin,
    createTagDecorationPlugin,
    closeTagLinkPopup,
    TagLinkPopup,
    type TagLinkPluginState,
} from "@/components/prosemirror/tag-links";
import "@/components/prosemirror/tag-links/tag-links.css";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import "prosemirror-example-setup/style/style.css";
import "prosemirror-view/style/prosemirror.css";
import "@/components/prosemirror/tables/tables.css";
import "./simple-todo.css";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { Note } from "./index";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { useTabScrollPersistence } from "@/hooks/useTabScrollPersistence";
import { useTabCursorPersistence } from "@/hooks/useTabCursorPersistence";
import { TagInput } from "./TagInput";
import { ProjectInput } from "./ProjectInput";
import { onRefresh, emit, subscribe } from "@/lib/events";
import { BacklinksPanel, CollapsibleSection } from "./BacklinksPanel";
import { toast } from "sonner";
import { OverlayScrollbar } from "@/components/OverlayScrollbar";

interface NotesViewProps {
    noteFileName: string;
    tabId: string;
    autoFocus?: boolean;
    compact?: boolean; // Hides header toolbar when embedded
}

interface Heading {
    level: number;
    text: string;
    id: string;
}

export function NotesView(props: NotesViewProps) {
    const { noteFileName, tabId, autoFocus = true, compact = false } = props;
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, openTab } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [note, setNote] = useState<Note | null>(null);
    const [content, setContent] = useState("");
    const [_saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
    const [tags, setTags] = useState<string[]>([]);
    const [project, setProject] = useState<string | null>(null);

    const [isRichTextMode] = useState(true);
    const [headings, setHeadings] = useState<Heading[]>([]);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
    const [focusedHeadingIndex, setFocusedHeadingIndex] = useState<number>(0);
    const [isMinimapFocused, setIsMinimapFocused] = useState(false);
    const [wikiLinkState, setWikiLinkState] = useState<WikiLinkPluginState>({
        active: false,
        range: null,
        query: "",
        selectedIndex: 0,
    });
    const [tagLinkState, setTagLinkState] = useState<TagLinkPluginState>({
        active: false,
        range: null,
        query: "",
        selectedIndex: 0,
    });

    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const toolbarContainerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useTabScrollPersistence(tabId);
    const { saveCursor, restoreCursor } = useTabCursorPersistence(tabId);
    const menubarObserverRef = useRef<MutationObserver | null>(null);
    const initializedContentRef = useRef<string>("");
    const currentNoteFileNameRef = useRef<string>("");
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSavedContentRef = useRef<string>("");
    const hasSetTabNameRef = useRef<boolean>(false);
    const minimapRef = useRef<HTMLDivElement>(null);
    const lastKnownMtimeRef = useRef<number | null>(null);
    const prevActiveTabIdRef = useRef<string | undefined>(undefined);
    const { currentTheme } = useTheme();

    // Subscribe to wiki link click events and navigate
    useEffect(() => {
        return subscribe("wikilink:click", async ({ target }) => {
            // Check if this is a todo link (e.g., todos/todo-1737036787-slug.md)
            if (target.startsWith("todos/")) {
                // Extract the todo ID from the path (remove "todos/" prefix and ".md" suffix)
                let selectedTodoId = target.slice(6); // Remove "todos/" prefix
                if (selectedTodoId.endsWith(".md")) {
                    selectedTodoId = selectedTodoId.slice(0, -3); // Remove ".md" suffix
                }

                // Fetch the todo to get its project
                try {
                    const todo = await todosAPI.getTodoById({ todoId: selectedTodoId });
                    openTab({
                        pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
                        view: "browser",
                        props: { project: todo.project, selectedTodoId },
                    });
                } catch (error) {
                    console.error("Failed to fetch todo for wiki link:", error);
                    // Fallback: open todos without project filter
                    openTab({
                        pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
                        view: "browser",
                        props: { selectedTodoId },
                    });
                }
                return;
            }

            // Default: open as a note
            openTab({
                pluginMeta: { id: "notes", name: "Notes", icon: "file" },
                view: "editor",
                props: { noteFileName: `${target}.md` },
            });
        });
    }, [openTab]);

    // Subscribe to tag click events and navigate to tag detail
    useEffect(() => {
        return subscribe("tag:click", ({ tag }) => {
            openTab({
                pluginMeta: { id: "tags", name: "Tags", icon: "hash" },
                view: "detail",
                props: { tagName: tag },
            });
        });
    }, [openTab]);

    // Subscribe to copy markdown events
    useEffect(() => {
        return subscribe("notes:copyMarkdown", ({ noteFileName: targetFileName }) => {
            // Only handle if this is the note being copied
            if (targetFileName !== noteFileName) return;

            // Get current markdown from editor if available, otherwise use state
            let markdown = content;
            if (viewRef.current) {
                markdown = tableMarkdownSerializer.serialize(viewRef.current.state.doc);
            }

            // Copy to clipboard
            navigator.clipboard.writeText(markdown).catch((err) => {
                console.error("Failed to copy markdown:", err);
            });
        });
    }, [noteFileName, content]);

    // Memoize API instance to prevent infinite rerenders
    const notesAPI = useNotesAPI();

    // Parse headings from markdown content
    const parseHeadings = useCallback((markdown: string): Heading[] => {
        const lines = markdown.split("\n");
        const extractedHeadings: Heading[] = [];

        lines.forEach((line) => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match && match[1] && match[2]) {
                const level = match[1].length;
                // Strip markdown formatting (bold, italic, code, links)
                const text = match[2]
                    .trim()
                    .replace(/\*\*(.+?)\*\*/g, "$1") // bold **text**
                    .replace(/\*(.+?)\*/g, "$1") // italic *text*
                    .replace(/__(.+?)__/g, "$1") // bold __text__
                    .replace(/_(.+?)_/g, "$1") // italic _text_
                    .replace(/`(.+?)`/g, "$1") // code `text`
                    .replace(/\[(.+?)\]\(.+?\)/g, "$1"); // links [text](url)
                const id = text
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, "")
                    .replace(/\s+/g, "-");
                extractedHeadings.push({ level, text, id });
            }
        });

        return extractedHeadings;
    }, []);

    // Scroll to heading in editor (preview only - doesn't move cursor or change focus)
    const scrollToHeadingPreview = useCallback(
        (headingId: string) => {
            if (!viewRef.current || !editorRef.current) return;

            const doc = viewRef.current.state.doc;
            const headingToFind = headings.find((h) => h.id === headingId);
            if (!headingToFind) return;

            // Find the heading position in the document
            let foundPos = -1;
            doc.descendants((node, pos) => {
                if (node.type.name === "heading" && node.textContent.trim() === headingToFind.text) {
                    foundPos = pos;
                    return false;
                }
            });

            if (foundPos !== -1) {
                const domAtPos = viewRef.current.domAtPos(foundPos);
                if (domAtPos && domAtPos.node) {
                    const element = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement;
                    if (element) {
                        element.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                }
            }
        },
        [headings]
    );

    // Scroll to heading and move cursor (used when selecting with Enter)
    const scrollToHeading = useCallback(
        (headingId: string) => {
            if (!viewRef.current || !editorRef.current) return;

            const doc = viewRef.current.state.doc;
            const headingToFind = headings.find((h) => h.id === headingId);
            if (!headingToFind) return;

            // Find the heading position in the document
            let foundPos = -1;
            doc.descendants((node, pos) => {
                if (node.type.name === "heading" && node.textContent.trim() === headingToFind.text) {
                    foundPos = pos;
                    return false;
                }
            });

            if (foundPos !== -1) {
                // Set selection at the heading and move cursor there
                const tr = viewRef.current.state.tr.setSelection(Selection.near(doc.resolve(foundPos)));
                viewRef.current.dispatch(tr);

                // Exit TOC mode and focus editor
                setIsMinimapFocused(false);
                setActiveHeadingId(headingId);

                // Small delay then scroll and focus
                requestAnimationFrame(() => {
                    const domAtPos = viewRef.current!.domAtPos(foundPos);
                    if (domAtPos && domAtPos.node) {
                        const element = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement;
                        if (element) {
                            element.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                    }
                    // Focus the editor after scrolling
                    viewRef.current?.focus();
                });
            }
        },
        [headings]
    );

    // Update active heading based on cursor position
    const updateActiveHeadingFromCursor = useCallback(() => {
        if (!viewRef.current || headings.length === 0) return;

        const state = viewRef.current.state;
        const cursorPos = state.selection.from;
        const doc = state.doc;

        // Find the closest heading before the cursor position
        let closestHeading: string | null = null;
        let closestPos = -1;

        doc.descendants((node, pos) => {
            if (node.type.name === "heading" && pos <= cursorPos) {
                const headingText = node.textContent.trim();
                const matchingHeading = headings.find((h) => h.text === headingText);

                if (matchingHeading && pos > closestPos) {
                    closestPos = pos;
                    closestHeading = matchingHeading.id;
                }
            }
        });

        // If no heading found before cursor, use the first heading
        if (!closestHeading && headings.length > 0) {
            closestHeading = headings[0]?.id || null;
        }

        if (closestHeading && closestHeading !== activeHeadingId) {
            setActiveHeadingId(closestHeading);
            const index = headings.findIndex((h) => h.id === closestHeading);
            if (index !== -1) {
                setFocusedHeadingIndex(index);
            }
        }
    }, [headings, activeHeadingId]);

    // Update active heading based on scroll position (fallback for when cursor isn't moving)
    const updateActiveHeadingFromScroll = useCallback(() => {
        if (!editorRef.current || headings.length === 0) return;

        const editor = editorRef.current.querySelector(".ProseMirror");
        if (!editor) return;

        const editorRect = editor.getBoundingClientRect();
        const viewportMiddle = editorRect.top + editorRect.height / 3;

        // Find all heading elements in the editor
        const headingElements = editor.querySelectorAll("h1, h2, h3, h4, h5, h6");

        let closestHeading: string | null = null;
        let closestDistance = Infinity;

        headingElements.forEach((element) => {
            const rect = element.getBoundingClientRect();
            const distance = Math.abs(rect.top - viewportMiddle);

            const headingText = element.textContent?.trim() || "";
            const matchingHeading = headings.find((h) => h.text === headingText);

            if (matchingHeading && distance < closestDistance && rect.top <= viewportMiddle) {
                closestDistance = distance;
                closestHeading = matchingHeading.id;
            }
        });

        if (closestHeading && closestHeading !== activeHeadingId) {
            setActiveHeadingId(closestHeading);
            const index = headings.findIndex((h) => h.id === closestHeading);
            if (index !== -1) {
                setFocusedHeadingIndex(index);
            }
        }
    }, [headings, activeHeadingId]);

    // Immediate save function (for blur events)
    const saveImmediately = useCallback(
        async (contentToSave: string) => {
            if (contentToSave === lastSavedContentRef.current) {
                setSaveState("saved");
                return;
            }

            try {
                setSaveState("saving");
                const savedNote = await notesAPI.saveNote({ fileName: noteFileName, content: contentToSave });
                lastSavedContentRef.current = contentToSave;
                // Update mtime to prevent false "external change" detection
                if (savedNote?.mtime) {
                    lastKnownMtimeRef.current = savedNote.mtime;
                }
                setSaveState("saved");
            } catch {
                setSaveState("error");
                setTimeout(() => setSaveState("unsaved"), 3000); // Reset error state after 3s
            }
        },
        [notesAPI, noteFileName]
    );

    // Debounced auto-save function
    const debouncedSave = useCallback(
        async (contentToSave: string) => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            saveTimeoutRef.current = setTimeout(async () => {
                if (contentToSave === lastSavedContentRef.current) {
                    setSaveState("saved");
                    return;
                }

                try {
                    setSaveState("saving");
                    const savedNote = await notesAPI.saveNote({ fileName: noteFileName, content: contentToSave });
                    lastSavedContentRef.current = contentToSave;
                    // Update mtime to prevent false "external change" detection
                    if (savedNote?.mtime) {
                        lastKnownMtimeRef.current = savedNote.mtime;
                    }
                    setSaveState("saved");
                } catch {
                    setSaveState("error");
                    setTimeout(() => setSaveState("unsaved"), 3000); // Reset error state after 3s
                }
            }, 200); // 0.2 second delay
        },
        [notesAPI, noteFileName]
    );

    // Handle tag updates
    const handleTagsChange = useCallback(
        async (newTags: string[]) => {
            setTags(newTags);
            try {
                const updatedNote = await notesAPI.updateNoteTags({ fileName: noteFileName, tags: newTags });
                setNote(updatedNote);
                setContent(updatedNote.content);
                lastSavedContentRef.current = updatedNote.content;
            } catch (err) {
                console.error("Failed to update tags:", err);
            }
        },
        [notesAPI, noteFileName]
    );

    // Handle project updates
    const handleProjectChange = useCallback(
        async (newProject: string | null) => {
            setProject(newProject);
            try {
                const updatedNote = await notesAPI.updateNoteProject({ fileName: noteFileName, project: newProject });
                setNote(updatedNote);
                setContent(updatedNote.content);
                lastSavedContentRef.current = updatedNote.content;
            } catch (err) {
                console.error("Failed to update project:", err);
            }
        },
        [notesAPI, noteFileName]
    );

    // Update content and trigger save state change
    const updateContent = useCallback(
        (newContent: string) => {
            setContent(newContent);
            setHeadings(parseHeadings(newContent));
            if (newContent !== lastSavedContentRef.current) {
                setSaveState("unsaved");
                debouncedSave(newContent);
            }
        },
        [debouncedSave, parseHeadings]
    );

    // Update tab name to show just the document name - only once when component mounts
    useEffect(() => {
        // Only set tab name when this tab is active and we haven't set it yet
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            // Remove .md extension for cleaner display
            const displayName = noteFileName.replace(/\.md$/, "");
            setTabName(tabId, displayName);
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, noteFileName, setTabName]);

    useEffect(() => {
        let cancelled = false;

        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);
                if (!notesAPI || !notesAPI.getNotes) {
                    throw new Error("Notes API not found");
                }
                const noteResult = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });

                // Don't update state if component unmounted or note changed
                if (cancelled) return;

                const noteContent = noteResult?.content || "";
                setNote(noteResult);
                setContent(noteContent);
                setHeadings(parseHeadings(noteContent));
                lastSavedContentRef.current = noteContent;
                lastKnownMtimeRef.current = noteResult?.mtime ?? null;
                setSaveState("saved");

                // Extract tags from front matter
                const noteTags = noteResult?.frontMatter?.tags;
                if (Array.isArray(noteTags)) {
                    setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                } else {
                    setTags([]);
                }

                // Extract project from front matter
                const noteProject = noteResult?.frontMatter?.project;
                if (typeof noteProject === "string") {
                    setProject(noteProject);
                } else {
                    setProject(null);
                }
            } catch (err) {
                if (cancelled) return;
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch notes";
                setError(errorMessage);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };
        fetchData();

        return () => {
            cancelled = true;
        };
    }, [noteFileName, notesAPI, setLoading, setError, parseHeadings]);

    // Listen for refresh events to reload tags and project
    useEffect(() => {
        const unsubscribe = onRefresh(
            async (detail) => {
                // Only refresh if this is the note being refreshed
                if (detail.identifier === noteFileName) {
                    try {
                        const noteResult = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });
                        const noteTags = noteResult?.frontMatter?.tags;
                        if (Array.isArray(noteTags)) {
                            setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                        } else {
                            setTags([]);
                        }
                        // Extract project from front matter
                        const noteProject = noteResult?.frontMatter?.project;
                        if (typeof noteProject === "string") {
                            setProject(noteProject);
                        } else {
                            setProject(null);
                        }
                        // Update note state to reflect new front matter
                        setNote(noteResult);
                    } catch (error) {
                        console.error("Failed to refresh note:", error);
                    }
                }
            },
            "note"
        );

        return unsubscribe;
    }, [noteFileName, notesAPI]);

    // Store updateActiveHeadingFromCursor in a ref to avoid infinite rerenders
    const updateActiveHeadingFromCursorRef = useRef(updateActiveHeadingFromCursor);
    useEffect(() => {
        updateActiveHeadingFromCursorRef.current = updateActiveHeadingFromCursor;
    }, [updateActiveHeadingFromCursor]);

    // Initialize ProseMirror editor - wait for content to be loaded
    useEffect(() => {
        if (!editorRef.current || !isRichTextMode || !note) {
            return;
        }

        // Wait until we have the correct note data loaded
        if (note.fileName !== noteFileName) {
            return;
        }

        // Check if this is a different note than what's in the editor
        const isNewNote = currentNoteFileNameRef.current !== noteFileName;
        const contentToUse = note.content || "";

        // If editor exists and note changed, reuse the editor by swapping content
        if (isNewNote && viewRef.current) {
            const doc = tableMarkdownParser.parse(contentToUse) || tableSchema.nodes.doc.createAndFill();
            // Create new state with same plugins but new document
            const stateWithNewDoc = EditorState.create({
                doc,
                plugins: viewRef.current.state.plugins,
                selection: Selection.atStart(doc!),
            });
            viewRef.current.updateState(stateWithNewDoc);
            currentNoteFileNameRef.current = noteFileName;
            initializedContentRef.current = contentToUse;
            return;
        }

        // If no note change and editor exists, nothing to do
        if (!isNewNote && viewRef.current) {
            return;
        }

        // Only destroy if we're creating fresh (shouldn't happen often now)
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }
        const doc = tableMarkdownParser.parse(contentToUse) || tableSchema.nodes.doc.createAndFill();

        // Custom keymap for tab indentation in lists
        const listIndentKeymap = keymap({
            "Tab": chainCommands(sinkListItem(tableSchema.nodes.list_item), wrapInList(tableSchema.nodes.bullet_list)),
            "Shift-Tab": liftListItem(tableSchema.nodes.list_item),
        });

        // Wiki link plugin for [[note]] suggestions
        const wikiLinkPlugin = createWikiLinkPlugin({
            schema: tableSchema,
            onStateChange: setWikiLinkState,
        });

        // Tag link plugin for #tag suggestions
        const tagLinkPlugin = createTagLinkPlugin({
            onStateChange: setTagLinkState,
        });

        // Tag decoration plugin for styling completed tags and atomic deletion
        const tagDecorationPlugin = createTagDecorationPlugin();

        let state = EditorState.create({
            doc,
            plugins: [
                ...getTablePlugins(), // Table navigation must come BEFORE exampleSetup
                todoKeymap, // Todo Enter handling must come BEFORE exampleSetup's Enter handler
                ...exampleSetup({ schema: tableSchema, floatingMenu: false }),
                listIndentKeymap, // Add our custom keymap after exampleSetup
                todoPlugin, // Render and handle todo checkboxes
                wikiLinkPlugin, // Wiki link suggestions
                tagLinkPlugin, // Tag suggestions
                tagDecorationPlugin, // Tag decorations and atomic deletion
            ],
        });

        // Apply table fixes to ensure proper table structure
        const fixTransaction = fixTables(state);
        if (fixTransaction) {
            state = state.apply(fixTransaction);
        }

        // Normalize table column counts (ensures all rows have same number of cells)
        const normalizeTransaction = normalizeTableColumns(state);
        if (normalizeTransaction) {
            state = state.apply(normalizeTransaction);
        }

        const view = new EditorView(editorRef.current, {
            state,
            dispatchTransaction(transaction) {
                const newState = view.state.apply(transaction);
                view.updateState(newState);

                // Check if selection changed
                if (transaction.selectionSet) {
                    // Update active heading based on cursor position
                    setTimeout(() => updateActiveHeadingFromCursorRef.current(), 0);
                    // Save cursor position for persistence
                    saveCursor(view);
                }

                const markdown = tableMarkdownSerializer.serialize(newState.doc);
                updateContent(markdown);
            },
            handleDOMEvents: {
                mousedown: (_view, event) => {
                    // Prevent selection change when clicking on tag links
                    const target = event.target as HTMLElement;
                    const tagLinkElement = target.classList.contains("tag-link")
                        ? target
                        : target.closest(".tag-link");
                    if (tagLinkElement) {
                        event.preventDefault();
                        return true;
                    }
                    return false;
                },
                blur: () => {
                    const markdown = tableMarkdownSerializer.serialize(view.state.doc);
                    saveImmediately(markdown);
                    return false; // Let other handlers run
                },
                click: (view, event) => {
                    // Handle clicks on tag decorations
                    const target = event.target as HTMLElement;
                    // Check if click is on a tag-link or inside one
                    const tagLinkElement = target.classList.contains("tag-link")
                        ? target
                        : target.closest(".tag-link");

                    if (tagLinkElement) {
                        event.preventDefault();

                        // Get the document position from click coordinates
                        const coords = { left: event.clientX, top: event.clientY };
                        const posAtCoords = view.posAtCoords(coords);

                        if (posAtCoords) {
                            // Find the tag at this position by looking at the text content
                            const pos = posAtCoords.pos;
                            const $pos = view.state.doc.resolve(pos);
                            const textContent = $pos.parent.textContent;
                            const offsetInBlock = $pos.parentOffset;

                            // Find the tag that contains this position
                            // Look backwards for # and forwards for end of tag
                            const TAG_CHAR_REGEX = /[a-zA-Z0-9_-]/;
                            let hashPos = offsetInBlock;

                            // Search backwards for the #
                            while (hashPos > 0 && textContent[hashPos - 1] !== '#') {
                                if (!TAG_CHAR_REGEX.test(textContent[hashPos - 1] || '')) {
                                    break;
                                }
                                hashPos--;
                            }

                            // Check if we found a # right before
                            if (hashPos > 0 && textContent[hashPos - 1] === '#') {
                                // Find the end of the tag
                                let endPos = hashPos;
                                while (endPos < textContent.length && TAG_CHAR_REGEX.test(textContent[endPos] || '')) {
                                    endPos++;
                                }

                                const tagName = textContent.slice(hashPos, endPos);
                                if (tagName) {
                                    // Close any open tag popup before navigating
                                    closeTagLinkPopup(view);
                                    emit("tag:click", { tag: tagName, sourceNote: noteFileName });
                                }
                            }
                        }
                        return true;
                    }
                    return false;
                },
            },
            // Handle clicks on wiki_link nodes
            handleClickOn(_view, _pos, node, _nodePos, event, direct) {
                if (node.type.name === "wiki_link" && direct) {
                    event.preventDefault();
                    const linkTarget = node.attrs.href;
                    // Emit event for navigation - handled by subscriber
                    emit("wikilink:click", { target: linkTarget, sourceNote: noteFileName });
                    return true;
                }
                return false;
            },
            // Handle Enter key on wiki_link nodes
            handleKeyDown(view, event) {
                if (event.key === "Enter") {
                    const { selection } = view.state;

                    // Check if a wiki_link node is selected (NodeSelection)
                    if (selection instanceof NodeSelection) {
                        const selectedNode = selection.node;
                        if (selectedNode.type.name === "wiki_link") {
                            event.preventDefault();
                            emit("wikilink:click", { target: selectedNode.attrs.href, sourceNote: noteFileName });
                            return true;
                        }
                    }

                    // Also handle cursor adjacent to wiki_link
                    const { from, to } = selection;
                    if (from === to) {
                        const $pos = view.state.doc.resolve(from);

                        // Check node immediately before cursor
                        if ($pos.nodeBefore?.type.name === "wiki_link") {
                            event.preventDefault();
                            emit("wikilink:click", { target: $pos.nodeBefore.attrs.href, sourceNote: noteFileName });
                            return true;
                        }

                        // Check node immediately after cursor
                        if ($pos.nodeAfter?.type.name === "wiki_link") {
                            event.preventDefault();
                            emit("wikilink:click", { target: $pos.nodeAfter.attrs.href, sourceNote: noteFileName });
                            return true;
                        }
                    }
                }
                return false;
            },
        });

        viewRef.current = view;
        initializedContentRef.current = contentToUse;
        currentNoteFileNameRef.current = noteFileName;

        // Focus editor and restore cursor position (or place at start if no saved position)
        if (autoFocus) {
            requestAnimationFrame(() => {
                try {
                    view.focus();
                    // Try to restore saved cursor position, otherwise place at start
                    restoreCursor(view);
                } catch {
                    // no-op if focusing fails
                }
            });
        } else {
            // Even without autoFocus, try to restore cursor position
            requestAnimationFrame(() => {
                try {
                    restoreCursor(view);
                } catch {
                    // no-op
                }
            });
        }

        // Store ref value in variable for cleanup function
        const toolbarContainer = toolbarContainerRef.current;

        return () => {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
            if (toolbarContainer) {
                toolbarContainer.innerHTML = "";
            }
            if (menubarObserverRef.current) {
                menubarObserverRef.current.disconnect();
                menubarObserverRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRichTextMode, noteFileName, note, updateContent, saveImmediately]); // content and updateActiveHeadingFromCursor intentionally omitted to prevent editor recreation

    // Update editor content when content changes externally (only after initial load)
    useEffect(() => {
        if (!viewRef.current || !isRichTextMode || !note) return;

        // Skip if this is the content we just initialized with
        if (content === initializedContentRef.current) return;

        // Only update if the markdown content is different from what's in the editor
        const currentMarkdown = tableMarkdownSerializer.serialize(viewRef.current.state.doc);
        if (currentMarkdown !== content) {
            const doc = tableMarkdownParser.parse(content || "") || tableSchema.nodes.doc.createAndFill();

            // Recreate the custom keymap for consistency
            const listIndentKeymap = keymap({
                "Tab": chainCommands(sinkListItem(tableSchema.nodes.list_item), wrapInList(tableSchema.nodes.bullet_list)),
                "Shift-Tab": liftListItem(tableSchema.nodes.list_item),
            });

            // Wiki link plugin for [[note]] suggestions
            const wikiLinkPlugin = createWikiLinkPlugin({
                schema: tableSchema,
                onStateChange: setWikiLinkState,
            });

            // Tag link plugin for #tag suggestions
            const tagLinkPlugin = createTagLinkPlugin({
                onStateChange: setTagLinkState,
            });

            // Tag decoration plugin for styling completed tags and atomic deletion
            const tagDecorationPlugin = createTagDecorationPlugin();

            let newState = EditorState.create({
                doc,
                plugins: [
                    ...getTablePlugins(), // Table navigation must come BEFORE exampleSetup
                    todoKeymap, // Todo Enter handling must come BEFORE exampleSetup's Enter handler
                    ...exampleSetup({ schema: tableSchema, floatingMenu: false }),
                    listIndentKeymap,
                    todoPlugin,
                    wikiLinkPlugin,
                    tagLinkPlugin,
                    tagDecorationPlugin,
                ],
            });

            // Apply table fixes to ensure proper table structure
            const fixTransaction = fixTables(newState);
            if (fixTransaction) {
                newState = newState.apply(fixTransaction);
            }

            // Normalize table column counts
            const normalizeTransaction = normalizeTableColumns(newState);
            if (normalizeTransaction) {
                newState = newState.apply(normalizeTransaction);
            }

            viewRef.current.updateState(newState);
            initializedContentRef.current = content;
        }
    }, [content, isRichTextMode, note]);

    // Move ProseMirror menubar into the header toolbar container
    useEffect(() => {
        if (!isRichTextMode || !note) return;
        const mountNode = editorRef.current;
        const headerTarget = toolbarContainerRef.current;
        if (!mountNode || !headerTarget) return;

        const attemptMove = () => {
            const menubar = mountNode.querySelector(".ProseMirror-menubar") as HTMLElement | null;
            if (menubar && headerTarget) {
                headerTarget.innerHTML = "";
                headerTarget.appendChild(menubar);
                menubar.style.position = "static";
                menubar.style.top = "";
                menubar.style.background = "transparent";
                menubar.style.border = "0";
                return true;
            }
            return false;
        };

        if (!attemptMove()) {
            if (menubarObserverRef.current) menubarObserverRef.current.disconnect();
            const observer = new MutationObserver((_mutations) => {
                const menubar = mountNode.querySelector(".ProseMirror-menubar") as HTMLElement | null;
                if (menubar && menubar.parentElement === mountNode && attemptMove()) {
                    observer.disconnect();
                    menubarObserverRef.current = null;
                }
            });
            observer.observe(mountNode, { childList: true, subtree: true });
            menubarObserverRef.current = observer;
        }

        return () => {
            if (menubarObserverRef.current) {
                menubarObserverRef.current.disconnect();
                menubarObserverRef.current = null;
            }
        };
    }, [isRichTextMode, note]);

    // Clean up timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Focus editor when tab becomes active (for tab switching)
    useEffect(() => {
        if (activeTab?.id === tabId && autoFocus && viewRef.current) {
            // Small delay to ensure the tab transition is complete
            requestAnimationFrame(() => {
                try {
                    viewRef.current?.focus();
                } catch {
                    // no-op if focusing fails
                }
            });
        }
    }, [activeTab?.id, tabId, autoFocus]);

    // Check for external changes when tab becomes active (not on initial mount)
    useEffect(() => {
        const wasActive = prevActiveTabIdRef.current === tabId;
        const isActive = activeTab?.id === tabId;
        prevActiveTabIdRef.current = activeTab?.id;

        // Only check when transitioning from inactive to active
        if (!isActive || wasActive) return;
        if (!noteFileName) return;
        // Skip if we don't have an mtime yet (initial load still in progress)
        if (lastKnownMtimeRef.current === null) return;

        const checkForExternalChanges = async () => {
            try {
                const { mtime: currentMtime } = await notesAPI.getNoteMtime({ fileName: noteFileName });
                const lastKnownMtime = lastKnownMtimeRef.current;

                // No change detected
                if (currentMtime === lastKnownMtime) return;
                if (currentMtime === null) return; // File was deleted

                // Get current editor content
                const currentEditorContent = viewRef.current
                    ? tableMarkdownSerializer.serialize(viewRef.current.state.doc)
                    : content;

                const hasUnsavedEdits = currentEditorContent !== lastSavedContentRef.current;

                if (hasUnsavedEdits) {
                    // Show conflict toast
                    toast("Note was modified externally", {
                        duration: Infinity,
                        action: {
                            label: "Reload",
                            onClick: async () => {
                                // Reload the note from disk
                                const freshNote = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });
                                const freshContent = freshNote?.content || "";
                                setNote(freshNote);
                                setContent(freshContent);
                                setHeadings(parseHeadings(freshContent));
                                lastSavedContentRef.current = freshContent;
                                lastKnownMtimeRef.current = freshNote?.mtime ?? null;
                                initializedContentRef.current = freshContent;

                                // Update editor if it exists
                                if (viewRef.current) {
                                    const doc = tableMarkdownParser.parse(freshContent) || tableSchema.nodes.doc.createAndFill();
                                    const stateWithNewDoc = EditorState.create({
                                        doc,
                                        plugins: viewRef.current.state.plugins,
                                        selection: Selection.atStart(doc!),
                                    });
                                    viewRef.current.updateState(stateWithNewDoc);
                                }

                                // Update tags and project from front matter
                                const noteTags = freshNote?.frontMatter?.tags;
                                if (Array.isArray(noteTags)) {
                                    setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                                } else {
                                    setTags([]);
                                }
                                const noteProject = freshNote?.frontMatter?.project;
                                if (typeof noteProject === "string") {
                                    setProject(noteProject);
                                } else {
                                    setProject(null);
                                }
                            },
                        },
                        cancel: {
                            label: "Keep mine",
                            onClick: () => {
                                // Just update the mtime ref to suppress future warnings until next external change
                                lastKnownMtimeRef.current = currentMtime;
                            },
                        },
                    });
                } else {
                    // No unsaved edits - silently refresh
                    const freshNote = await notesAPI.getNoteByFileName({ fileName: noteFileName, skipCache: true });
                    const freshContent = freshNote?.content || "";
                    setNote(freshNote);
                    setContent(freshContent);
                    setHeadings(parseHeadings(freshContent));
                    lastSavedContentRef.current = freshContent;
                    lastKnownMtimeRef.current = freshNote?.mtime ?? null;
                    initializedContentRef.current = freshContent;

                    // Update editor if it exists
                    if (viewRef.current) {
                        const doc = tableMarkdownParser.parse(freshContent) || tableSchema.nodes.doc.createAndFill();
                        const stateWithNewDoc = EditorState.create({
                            doc,
                            plugins: viewRef.current.state.plugins,
                            selection: Selection.atStart(doc!),
                        });
                        viewRef.current.updateState(stateWithNewDoc);
                    }

                    // Update tags and project from front matter
                    const noteTags = freshNote?.frontMatter?.tags;
                    if (Array.isArray(noteTags)) {
                        setTags(noteTags.filter((tag): tag is string => typeof tag === "string"));
                    } else {
                        setTags([]);
                    }
                    const noteProject = freshNote?.frontMatter?.project;
                    if (typeof noteProject === "string") {
                        setProject(noteProject);
                    } else {
                        setProject(null);
                    }
                }
            } catch (error) {
                console.error("Failed to check for external changes:", error);
            }
        };

        checkForExternalChanges();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab?.id, tabId, noteFileName]); // Only run on tab activation, not on content changes

    // Add scroll listener to track current section (when cursor isn't moving)
    useEffect(() => {
        if (!editorRef.current || !isRichTextMode) return;

        const editor = editorRef.current.querySelector(".ProseMirror");
        if (!editor) return;

        const handleScroll = () => {
            // Only update from scroll if we're not actively typing/moving cursor
            updateActiveHeadingFromScroll();
        };

        editor.addEventListener("scroll", handleScroll);
        // Also listen to window scroll in case the container scrolls
        window.addEventListener("scroll", handleScroll);

        // Initial check based on cursor position
        if (viewRef.current) {
            updateActiveHeadingFromCursor();
        } else {
            updateActiveHeadingFromScroll();
        }

        return () => {
            editor.removeEventListener("scroll", handleScroll);
            window.removeEventListener("scroll", handleScroll);
        };
    }, [isRichTextMode, updateActiveHeadingFromScroll, updateActiveHeadingFromCursor]);

    // Keyboard navigation for mini-map
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // CMD+/ to focus mini-map
            if ((e.metaKey || e.ctrlKey) && e.key === "/") {
                e.preventDefault();
                setIsMinimapFocused(true);
                minimapRef.current?.focus();

                // Set focused index to current active heading
                const currentIndex = headings.findIndex((h) => h.id === activeHeadingId);
                if (currentIndex !== -1) {
                    setFocusedHeadingIndex(currentIndex);
                }
                return;
            }

            // Navigation when mini-map is focused
            if (isMinimapFocused && headings.length > 0) {
                switch (e.key) {
                    case "ArrowUp":
                        e.preventDefault();
                        {
                            const newIndex = focusedHeadingIndex === 0 ? headings.length - 1 : focusedHeadingIndex - 1;
                            setFocusedHeadingIndex(newIndex);
                            // Scroll to preview the heading
                            if (headings[newIndex]) {
                                scrollToHeadingPreview(headings[newIndex].id);
                            }
                        }
                        break;
                    case "ArrowDown":
                        e.preventDefault();
                        {
                            const newIndex = focusedHeadingIndex === headings.length - 1 ? 0 : focusedHeadingIndex + 1;
                            setFocusedHeadingIndex(newIndex);
                            // Scroll to preview the heading
                            if (headings[newIndex]) {
                                scrollToHeadingPreview(headings[newIndex].id);
                            }
                        }
                        break;
                    case "Home":
                        e.preventDefault();
                        setFocusedHeadingIndex(0);
                        break;
                    case "End":
                        e.preventDefault();
                        setFocusedHeadingIndex(headings.length - 1);
                        break;
                    case "Enter":
                    case " ": // Also allow Space to jump
                        e.preventDefault();
                        if (headings[focusedHeadingIndex]) {
                            scrollToHeading(headings[focusedHeadingIndex].id);
                        }
                        break;
                    case "Escape":
                        e.preventDefault();
                        setIsMinimapFocused(false);
                        viewRef.current?.focus();
                        break;
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isMinimapFocused, headings, focusedHeadingIndex, activeHeadingId, scrollToHeading, scrollToHeadingPreview]);

    // Single wrapper - ref stays on the same element across all states
    return (
        <div className="h-full overflow-hidden flex flex-col">
            {(loading || !note) ? (
                // Loading placeholder
                <div className="h-full" />
            ) : error ? (
                // Error state
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertDescription>Error: {error}</AlertDescription>
                    </Alert>
                </div>
            ) : (
                // Content
                <>
            {/* Header: filename + toolbar + mode/save */}
            <div
                className="shrink-0"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderBottom: `1px solid ${currentTheme.styles.borderDefault}`,
                }}
            >
                <div className="px-4 py-2 flex items-center gap-3">
                    <div className="flex flex-col items-start gap-1 min-w-0">
                        {/* Breadcrumb for folder path */}
                        {(() => {
                            const pathWithoutExt = noteFileName.replace(/\.md$/, "");
                            const parts = pathWithoutExt.split("/");
                            const fileName = parts.pop() || pathWithoutExt;
                            const folderPath = parts;

                            return (
                                <>
                                    {folderPath.length > 0 && (
                                        <Breadcrumb>
                                            <BreadcrumbList className="text-xs">
                                                {folderPath.map((folder, index) => (
                                                    <BreadcrumbItem key={index}>
                                                        <span style={{ color: currentTheme.styles.contentTertiary }}>
                                                            {folder}
                                                        </span>
                                                        {index < folderPath.length - 1 && <BreadcrumbSeparator />}
                                                    </BreadcrumbItem>
                                                ))}
                                            </BreadcrumbList>
                                        </Breadcrumb>
                                    )}
                                    <div
                                        className="text-3xl font-bold"
                                        style={{ color: currentTheme.styles.contentPrimary }}
                                    >
                                        {fileName}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>

                {/* Project and Tags row */}
                <div className="px-4 pb-2 flex items-center gap-4">
                    <ProjectInput project={project} onProjectChange={handleProjectChange} />
                    <TagInput tags={tags} onTagsChange={handleTagsChange} placeholder="Add tag..." />
                </div>
            </div>

            {/* Editor with inline TOC */}
            <div className="flex-1 overflow-hidden flex min-h-0">
                {/* Main editor area - this is the scrollable content */}
                <OverlayScrollbar
                    scrollRef={scrollRef}
                    className="flex-1 h-full"
                    style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
                >
                    {isRichTextMode ? (
                        <div className={compact ? 'compact-editor' : ''}>
                            <div className="w-full max-w-4xl mx-auto px-6 py-4">
                                <div
                                    ref={editorRef}
                                    className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none focus:outline-none editor-content"
                                    style={
                                        {
                                            "--tw-prose-body": currentTheme.styles.contentPrimary,
                                            "--tw-prose-headings": currentTheme.styles.contentPrimary,
                                            "--tw-prose-links": currentTheme.styles.contentAccent,
                                            "--tw-prose-bold": currentTheme.styles.contentPrimary,
                                            "--tw-prose-counters": currentTheme.styles.contentSecondary,
                                            "--tw-prose-bullets": currentTheme.styles.contentSecondary,
                                            "--tw-prose-hr": currentTheme.styles.borderDefault,
                                            "--tw-prose-quotes": currentTheme.styles.contentPrimary,
                                            "--tw-prose-quote-borders": currentTheme.styles.borderDefault,
                                            "--tw-prose-captions": currentTheme.styles.contentSecondary,
                                            "--tw-prose-code": currentTheme.styles.contentPrimary,
                                            "--tw-prose-pre-code": currentTheme.styles.contentPrimary,
                                            "--tw-prose-pre-bg": currentTheme.styles.surfaceMuted,
                                            "--tw-prose-th-borders": currentTheme.styles.borderDefault,
                                            "--tw-prose-td-borders": currentTheme.styles.borderDefault,
                                            // Todo checkbox theme variables
                                            "--todo-border": currentTheme.styles.borderDefault,
                                            "--todo-bg": currentTheme.styles.surfacePrimary,
                                            "--todo-checked-bg": currentTheme.styles.semanticPrimary,
                                            "--todo-checked-fg": currentTheme.styles.semanticPrimaryForeground,
                                            "--todo-completed-text": currentTheme.styles.contentTertiary,
                                            // Tag theme variables
                                            "--tag-color": currentTheme.styles.contentAccent,
                                            "--tag-hover-bg": currentTheme.styles.surfaceAccent,
                                            color: currentTheme.styles.contentPrimary,
                                        } as React.CSSProperties
                                    }
                                />
                                {/* Wiki link popup */}
                                {viewRef.current && wikiLinkState.active && (
                                    <WikiLinkPopup
                                        view={viewRef.current}
                                        pluginState={wikiLinkState}
                                    />
                                )}
                                {/* Tag link popup */}
                                {viewRef.current && tagLinkState.active && (
                                    <TagLinkPopup
                                        view={viewRef.current}
                                        pluginState={tagLinkState}
                                    />
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full bg-background">
                            <div className="w-full max-w-4xl mx-auto px-6 py-4">
                                <textarea
                                    value={content}
                                    onChange={(e) => updateContent(e.target.value)}
                                    onBlur={() => saveImmediately(content)}
                                    placeholder="Write your markdown here..."
                                    className="w-full h-full min-h-[calc(100vh-200px)] bg-transparent border-0 resize-none font-mono text-sm focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground"
                                    autoFocus
                                />
                            </div>
                        </div>
                    )}
                </OverlayScrollbar>

                {/* Sidebar with TOC and Backlinks */}
                {isRichTextMode && !compact && (
                    <div
                        ref={minimapRef}
                        tabIndex={-1}
                        className={cn(
                            "w-48 shrink-0 border-l focus:outline-none transition-colors",
                            isMinimapFocused && "bg-accent/20"
                        )}
                        style={{
                            borderColor: currentTheme.styles.borderDefault,
                            backgroundColor: currentTheme.styles.surfacePrimary,
                        }}
                        onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget)) {
                                setIsMinimapFocused(false);
                            }
                        }}
                    >
                        <OverlayScrollbar className="h-full">
                            <div className="p-3 pt-4 space-y-4">
                            {/* Table of Contents (On This Page) */}
                            {headings.length > 0 && (
                                <CollapsibleSection title="On This Page" count={headings.length} defaultOpen={true}>
                                    <nav
                                        ref={(el) => {
                                            // Auto-scroll to keep focused item in view
                                            if (el && isMinimapFocused && focusedHeadingIndex >= 0) {
                                                const buttons = el.querySelectorAll('button');
                                                const focusedButton = buttons[focusedHeadingIndex];
                                                if (focusedButton) {
                                                    focusedButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
                                                }
                                            }
                                        }}
                                    >
                                        {isMinimapFocused && (
                                            <div className="flex justify-end mb-1">
                                                <span className="text-[9px] px-1 py-0.5 rounded bg-accent" style={{ color: currentTheme.styles.contentSecondary }}>
                                                    ↑↓
                                                </span>
                                            </div>
                                        )}
                                        {headings.map((heading, index) => {
                                            const isActive = activeHeadingId === heading.id;
                                            const isFocused = isMinimapFocused && index === focusedHeadingIndex;

                                            return (
                                                <button
                                                    key={heading.id}
                                                    onClick={() => {
                                                        scrollToHeading(heading.id);
                                                        setFocusedHeadingIndex(index);
                                                    }}
                                                    className={cn(
                                                        "w-full text-left px-2 py-1 rounded text-xs transition-colors truncate",
                                                        heading.level === 1 && "font-medium",
                                                        heading.level === 2 && "pl-4",
                                                        heading.level >= 3 && "pl-6 opacity-70",
                                                        !isActive && !isFocused && "hover:bg-accent/50",
                                                        isActive && !isFocused && "font-medium",
                                                        isFocused && "bg-accent ring-1 ring-primary/50"
                                                    )}
                                                    style={{
                                                        color: isFocused ? currentTheme.styles.contentPrimary : (isActive ? currentTheme.styles.contentAccent : currentTheme.styles.contentSecondary),
                                                    }}
                                                >
                                                    {heading.text}
                                                </button>
                                            );
                                        })}
                                    </nav>
                                </CollapsibleSection>
                            )}

                            {/* Backlinks Panel */}
                            <BacklinksPanel
                                noteFileName={noteFileName}
                                onOpenNote={(fileName) => {
                                    openTab({
                                        pluginMeta: { id: "notes", name: "Notes", icon: "file" },
                                        view: "editor",
                                        props: { noteFileName: fileName },
                                    });
                                }}
                                onCreateNote={async (noteName) => {
                                    // Create the note and open it
                                    const newFileName = `${noteName}.md`;
                                    await notesAPI.createNote({ fileName: newFileName, content: `# ${noteName}\n\n` });
                                    openTab({
                                        pluginMeta: { id: "notes", name: "Notes", icon: "file" },
                                        view: "editor",
                                        props: { noteFileName: newFileName },
                                    });
                                }}
                            />
                            </div>
                        </OverlayScrollbar>
                    </div>
                )}
            </div>
                </>
            )}
        </div>
    );
}

export default NotesView;
