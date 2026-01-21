import { useEffect, useRef, useState, useCallback } from "react";
import { EditorView } from "prosemirror-view";
import { useTheme } from "@/hooks/useTheme";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchPluginKey, performSearch } from "./search-plugin";

interface SearchPanelProps {
    view: EditorView;
    isOpen: boolean;
    onClose: () => void;
}

export function SearchPanel({ view, isOpen, onClose }: SearchPanelProps) {
    const { currentTheme } = useTheme();
    const [searchQuery, setSearchQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [resultsCount, setResultsCount] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Update search in ProseMirror
    const updateSearch = useCallback(() => {
        const results = performSearch(searchQuery, caseSensitive, view.state.doc);

        const tr = view.state.tr.setMeta(searchPluginKey, {
            query: searchQuery,
            caseSensitive,
            currentIndex: results.length > 0 ? currentIndex : 0,
            results,
        });

        view.dispatch(tr);
        setResultsCount(results.length);

        // Scroll to current match
        if (results[currentIndex]) {
            const domAtPos = view.domAtPos(results[currentIndex].from);
            if (domAtPos.node) {
                const element = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement;
                element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [view, searchQuery, caseSensitive, currentIndex]);

    // Handle search input change
    useEffect(() => {
        if (!isOpen) return;
        setCurrentIndex(0);
    }, [searchQuery, caseSensitive, isOpen]);

    // Update search when query, case sensitivity, or current index changes
    useEffect(() => {
        if (isOpen) {
            updateSearch();
        }
    }, [isOpen, updateSearch]);

    // Navigate to next match
    const goToNext = useCallback(() => {
        if (resultsCount === 0) return;
        setCurrentIndex((prev) => (prev + 1) % resultsCount);
    }, [resultsCount]);

    // Navigate to previous match
    const goToPrevious = useCallback(() => {
        if (resultsCount === 0) return;
        setCurrentIndex((prev) => (prev === 0 ? resultsCount - 1 : prev - 1));
    }, [resultsCount]);

    // Keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    goToPrevious();
                } else {
                    goToNext();
                }
            } else if (e.key === 'g' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (e.shiftKey) {
                    goToPrevious();
                } else {
                    goToNext();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, goToNext, goToPrevious]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isOpen]);

    // Clear search when closed
    useEffect(() => {
        if (!isOpen) {
            setSearchQuery('');
            setCurrentIndex(0);
            setResultsCount(0);
            // Clear search in editor
            const tr = view.state.tr.setMeta(searchPluginKey, {
                query: "",
                caseSensitive: false,
                currentIndex: 0,
                results: [],
            });
            view.dispatch(tr);
        }
    }, [isOpen, view]);

    if (!isOpen) return null;

    return (
        <div
            className="absolute top-2 right-2 z-50 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg border"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                borderColor: currentTheme.styles.borderDefault,
            }}
        >
            <Input
                ref={inputRef}
                type="text"
                placeholder="Find in note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 h-7 text-sm"
            />

            <div
                className="text-xs px-2"
                style={{ color: currentTheme.styles.contentSecondary }}
            >
                {resultsCount > 0 ? `${currentIndex + 1}/${resultsCount}` : '0/0'}
            </div>

            <Button
                variant="ghost"
                size="sm"
                onClick={goToPrevious}
                disabled={resultsCount === 0}
                className="h-7 w-7 p-0"
                title="Previous match (Shift+Enter)"
            >
                <ChevronUp className="h-4 w-4" />
            </Button>

            <Button
                variant="ghost"
                size="sm"
                onClick={goToNext}
                disabled={resultsCount === 0}
                className="h-7 w-7 p-0"
                title="Next match (Enter)"
            >
                <ChevronDown className="h-4 w-4" />
            </Button>

            <Button
                variant="ghost"
                size="sm"
                onClick={() => setCaseSensitive(!caseSensitive)}
                className={cn(
                    "h-7 px-2 text-xs font-mono",
                    caseSensitive && "bg-accent"
                )}
                title="Case sensitive"
            >
                Aa
            </Button>

            <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-7 w-7 p-0"
                title="Close (Esc)"
            >
                <X className="h-4 w-4" />
            </Button>
        </div>
    );
}
