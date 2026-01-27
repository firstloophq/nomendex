import * as React from "react";
import { Input } from "@/components/ui/input";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { SearchResult, Note } from "@/features/notes";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { notesPluginSerial } from "@/features/notes";
import { useRouting } from "@/hooks/useRouting";
import { useTheme } from "@/hooks/useTheme";

interface SearchNotesDialogProps {
    onSuccess?: () => void;
}

export function SearchNotesDialog({ onSuccess }: SearchNotesDialogProps) {
    const [query, setQuery] = React.useState("");
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const [previewNote, setPreviewNote] = React.useState<Note | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);
    const { closeDialog } = useCommandDialog();
    const { addNewTab, setActiveTabId } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const api = useNotesAPI();
    const inputRef = React.useRef<HTMLInputElement>(null);
    const resultsContainerRef = React.useRef<HTMLDivElement>(null);

    // Perform search
    const performSearch = React.useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) {
            setResults([]);
            setSelectedIndex(0);
            setPreviewNote(null);
            return;
        }

        setIsSearching(true);
        try {
            const searchResults = await api.searchNotes({ query: searchQuery });
            setResults(searchResults);
            setSelectedIndex(0);
        } catch (error) {
            console.error("Search failed:", error);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, [api]);

    // Debounce search
    React.useEffect(() => {
        const timer = setTimeout(() => {
            performSearch(query);
        }, 300);

        return () => clearTimeout(timer);
    }, [query, performSearch]);

    // Load preview when selection changes
    React.useEffect(() => {
        if (results.length === 0 || selectedIndex >= results.length) {
            setPreviewNote(null);
            return;
        }

        const selectedResult = results[selectedIndex];
        setIsLoadingPreview(true);

        api.getNoteByFileName({ fileName: selectedResult.fileName })
            .then((note) => {
                setPreviewNote(note);
            })
            .catch((error) => {
                console.error("Failed to load preview:", error);
                setPreviewNote(null);
            })
            .finally(() => {
                setIsLoadingPreview(false);
            });
    }, [results, selectedIndex, api]);

    // Scroll selected item into view
    React.useEffect(() => {
        if (resultsContainerRef.current && results.length > 0) {
            const selectedElement = resultsContainerRef.current.querySelector(`[data-index="${selectedIndex}"]`);
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    }, [selectedIndex, results.length]);

    // Open selected note with optional scroll to line
    const openNote = React.useCallback((fileName: string, scrollToLine?: number) => {
        const newTab = addNewTab({
            pluginMeta: notesPluginSerial,
            view: "editor",
            props: { noteFileName: fileName, scrollToLine }
        });

        if (newTab) {
            setActiveTabId(newTab.id);
        }

        // Navigate to workspace if not already there
        if (currentPath !== "/") {
            navigate("/");
        }

        closeDialog();
        onSuccess?.();
    }, [addNewTab, setActiveTabId, closeDialog, onSuccess, navigate, currentPath]);

    // Handle keyboard navigation
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (results.length > 0) {
                    setSelectedIndex(prev => (prev + 1) % results.length);
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (results.length > 0) {
                    setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[selectedIndex]) {
                    const contentMatches = results[selectedIndex].matches.filter(m => m.line > 0);
                    const firstMatchLine = contentMatches.length > 0 ? contentMatches[0].line : undefined;
                    openNote(results[selectedIndex].fileName, firstMatchLine);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeDialog();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [results, selectedIndex, openNote, closeDialog]);

    // Auto-focus input on mount
    React.useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Highlight matching text in a string
    const highlightMatches = (text: string) => {
        if (!query.trim()) return text;

        const parts: React.ReactNode[] = [];
        let lastIndex = 0;

        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let searchIndex = 0;

        while (true) {
            const index = lowerText.indexOf(lowerQuery, searchIndex);
            if (index === -1) break;

            if (index > lastIndex) {
                parts.push(text.slice(lastIndex, index));
            }

            parts.push(
                <mark
                    key={`${index}-${parts.length}`}
                    style={{
                        backgroundColor: styles.semanticPrimary,
                        color: styles.semanticPrimaryForeground,
                        borderRadius: "2px",
                        padding: "0 2px",
                    }}
                >
                    {text.slice(index, index + lowerQuery.length)}
                </mark>
            );

            lastIndex = index + lowerQuery.length;
            searchIndex = lastIndex;
        }

        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex));
        }

        return parts.length > 0 ? parts : text;
    };

    // Render preview content with highlights
    const renderPreviewContent = () => {
        if (!previewNote) return null;

        const lines = previewNote.content.split("\n");
        const selectedResult = results[selectedIndex];
        const matchLineNumbers = new Set(
            selectedResult?.matches
                .filter(m => m.line > 0)
                .map(m => m.line) || []
        );

        return (
            <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {lines.map((line, index) => {
                    const lineNumber = index + 1;
                    const isMatchLine = matchLineNumbers.has(lineNumber);

                    return (
                        <div
                            key={index}
                            className="px-1"
                            style={{
                                backgroundColor: isMatchLine ? styles.surfaceAccent : "transparent",
                                color: styles.contentPrimary,
                            }}
                        >
                            {isMatchLine ? highlightMatches(line) : line || " "}
                        </div>
                    );
                })}
            </div>
        );
    };

    const selectedResult = results[selectedIndex];

    return (
        <div className="flex flex-col h-full">
            {/* Search input - always at top */}
            <div
                className="shrink-0 px-4 py-3 border-b"
                style={{ borderColor: styles.borderDefault }}
            >
                <Input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search notes..."
                    className="w-full"
                />
            </div>

            {/* Two-column content area */}
            <div className="flex-1 flex min-h-0">
                {/* Left column - Results list */}
                <div
                    ref={resultsContainerRef}
                    className="w-1/2 overflow-y-auto border-r"
                    style={{ borderColor: styles.borderDefault }}
                >
                    {isSearching && (
                        <div
                            className="p-4 text-center"
                            style={{ color: styles.contentSecondary }}
                        >
                            Searching...
                        </div>
                    )}

                    {!isSearching && query && results.length === 0 && (
                        <div
                            className="p-4 text-center"
                            style={{ color: styles.contentSecondary }}
                        >
                            No results found
                        </div>
                    )}

                    {!isSearching && results.length > 0 && (
                        <div>
                            {results.map((result, index) => {
                                const isSelected = index === selectedIndex;
                                const contentMatches = result.matches.filter(m => m.line > 0);

                                return (
                                    <div
                                        key={result.fileName}
                                        data-index={index}
                                        className="px-3 py-2 cursor-pointer border-b"
                                        style={{
                                            backgroundColor: isSelected ? styles.surfaceTertiary : "transparent",
                                            borderColor: styles.borderDefault,
                                        }}
                                        onClick={() => openNote(result.fileName, contentMatches.length > 0 ? contentMatches[0].line : undefined)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <div
                                            className="font-medium text-sm truncate"
                                            style={{ color: styles.contentPrimary }}
                                        >
                                            {highlightMatches(result.fileName.replace(/\.md$/, ""))}
                                        </div>

                                        {result.folderPath && (
                                            <div
                                                className="text-xs truncate mt-0.5"
                                                style={{ color: styles.contentTertiary }}
                                            >
                                                {result.folderPath}
                                            </div>
                                        )}

                                        {contentMatches.length > 0 && (
                                            <div
                                                className="text-xs mt-1 truncate font-mono"
                                                style={{ color: styles.contentSecondary }}
                                            >
                                                L{contentMatches[0].line}: {contentMatches[0].text.trim()}
                                            </div>
                                        )}

                                        <div
                                            className="text-xs mt-1"
                                            style={{ color: styles.contentTertiary }}
                                        >
                                            {result.matches.length} match{result.matches.length !== 1 ? "es" : ""}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {!query && (
                        <div
                            className="p-4 text-center"
                            style={{ color: styles.contentSecondary }}
                        >
                            Start typing to search across all notes
                        </div>
                    )}
                </div>

                {/* Right column - Preview */}
                <div
                    className="w-1/2 overflow-y-auto"
                    style={{ backgroundColor: styles.surfacePrimary }}
                >
                    {isLoadingPreview && (
                        <div
                            className="p-4 text-center"
                            style={{ color: styles.contentSecondary }}
                        >
                            Loading preview...
                        </div>
                    )}

                    {!isLoadingPreview && previewNote && (
                        <div className="p-4">
                            <div
                                className="font-semibold text-base mb-1"
                                style={{ color: styles.contentPrimary }}
                            >
                                {highlightMatches(previewNote.fileName.replace(/\.md$/, ""))}
                            </div>
                            {selectedResult?.folderPath && (
                                <div
                                    className="text-xs mb-3"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    {selectedResult.folderPath}
                                </div>
                            )}
                            <div
                                className="border rounded p-3 overflow-x-auto"
                                style={{
                                    borderColor: styles.borderDefault,
                                    backgroundColor: styles.surfaceSecondary,
                                }}
                            >
                                {renderPreviewContent()}
                            </div>
                        </div>
                    )}

                    {!isLoadingPreview && !previewNote && query && results.length > 0 && (
                        <div
                            className="p-4 text-center"
                            style={{ color: styles.contentSecondary }}
                        >
                            Select a result to preview
                        </div>
                    )}

                    {!query && (
                        <div
                            className="h-full flex items-center justify-center"
                            style={{ color: styles.contentTertiary }}
                        >
                            <div className="text-center">
                                <div className="text-sm">Search results will appear here</div>
                                <div className="text-xs mt-2">Use ↑↓ to navigate, Enter to open</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
