import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { X, Filter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "@/hooks/useTheme";

interface TagFilterProps {
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
    onClearAll: () => void;
}

export function TagFilter({ availableTags, selectedTags, onTagToggle, onClearAll }: TagFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();

    // Filter suggestions based on input (tags that start with the input and aren't already selected)
    const suggestions = inputValue.trim()
        ? availableTags.filter(
              (tag) =>
                  tag.toLowerCase().startsWith(inputValue.toLowerCase()) &&
                  !selectedTags.includes(tag)
          )
        : availableTags.filter((tag) => !selectedTags.includes(tag));

    // Get top 5 suggestions to display
    const displayedSuggestions = suggestions.slice(0, 5);

    // Get the autocomplete suggestion (first match) - only when typing
    const autocompleteSuggestion = inputValue && displayedSuggestions.length > 0
        ? displayedSuggestions[0]
        : null;

    const addTag = (tagToAdd?: string) => {
        const trimmedValue = (tagToAdd || inputValue).trim();
        if (trimmedValue && availableTags.includes(trimmedValue) && !selectedTags.includes(trimmedValue)) {
            onTagToggle(trimmedValue);
            setInputValue("");
        }
    };

    const removeTag = (tagToRemove: string) => {
        onTagToggle(tagToRemove);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Tab" && autocompleteSuggestion) {
            e.preventDefault();
            setInputValue(autocompleteSuggestion);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) {
                setIsOpen(false);
                setInputValue("");
            } else {
                addTag();
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
            setInputValue("");
        } else if (e.key === "Backspace" && inputValue === "" && selectedTags.length > 0) {
            removeTag(selectedTags[selectedTags.length - 1]);
        }
    };

    // Focus input when dialog opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isOpen]);

    return (
        <>
            <div className="flex items-center gap-2 flex-wrap">
                {selectedTags.map((tag, tagIndex) => (
                    <span
                        key={`${tag}-${tagIndex}`}
                        className="group/tag flex items-center gap-0.5 text-xs"
                        style={{
                            color: currentTheme.styles.contentSecondary,
                        }}
                    >
                        {tag}
                        <button
                            onClick={() => removeTag(tag)}
                            className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
                            style={{
                                color: currentTheme.styles.contentTertiary,
                            }}
                            aria-label={`Remove ${tag} filter`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}

                {selectedTags.length > 0 && (
                    <button
                        className="text-[10px] uppercase tracking-wider opacity-40 hover:opacity-70 transition-opacity"
                        onClick={onClearAll}
                        style={{
                            color: currentTheme.styles.contentTertiary,
                        }}
                    >
                        Clear
                    </button>
                )}

                <button
                    className="text-[10px] uppercase tracking-wider opacity-40 hover:opacity-70 transition-opacity flex items-center gap-1"
                    onClick={() => setIsOpen(true)}
                    style={{
                        color: currentTheme.styles.contentTertiary,
                    }}
                >
                    <Filter className="h-2.5 w-2.5" />
                    Filter
                </button>
            </div>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent
                    className="sm:max-w-md"
                    style={{
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <DialogHeader>
                        <DialogTitle style={{ color: currentTheme.styles.contentPrimary }}>
                            Filter by Tags
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* Current filter tags */}
                        {selectedTags.length > 0 && (
                            <div className="flex flex-wrap gap-3">
                                {selectedTags.map((tag, tagIndex) => (
                                    <span
                                        key={`${tag}-${tagIndex}`}
                                        className="group/tag flex items-center gap-1 text-sm"
                                        style={{
                                            color: currentTheme.styles.contentPrimary,
                                        }}
                                    >
                                        {tag}
                                        <button
                                            onClick={() => removeTag(tag)}
                                            className="opacity-40 hover:opacity-100 transition-opacity"
                                            style={{ color: currentTheme.styles.contentSecondary }}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Input with ghost text autocomplete */}
                        <div
                            className="relative rounded-md"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                border: `1px solid ${currentTheme.styles.borderDefault}`,
                            }}
                        >
                            <div
                                className="absolute inset-0 px-3 py-2 text-sm pointer-events-none flex items-center overflow-hidden"
                            >
                                <span style={{ color: currentTheme.styles.contentPrimary }}>{inputValue}</span>
                                {autocompleteSuggestion && (
                                    <span style={{ color: currentTheme.styles.contentTertiary, opacity: 0.6 }}>
                                        {autocompleteSuggestion.slice(inputValue.length)}
                                    </span>
                                )}
                            </div>
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type to filter..."
                                className="w-full px-3 py-2 rounded-md text-sm outline-none relative"
                                style={{
                                    backgroundColor: 'transparent',
                                    color: 'transparent',
                                    caretColor: currentTheme.styles.contentPrimary,
                                }}
                            />
                        </div>

                        {/* Available tags */}
                        {displayedSuggestions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-1 text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                {displayedSuggestions.map((tag, index) => (
                                    <span key={`${tag}-${index}`} className="flex items-center">
                                        <button
                                            onClick={() => addTag(tag)}
                                            className="hover:underline transition-all"
                                            style={{
                                                color: currentTheme.styles.contentAccent,
                                            }}
                                        >
                                            {tag}
                                        </button>
                                        {index < displayedSuggestions.length - 1 && (
                                            <span className="mx-2">·</span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        )}

                        {availableTags.length === 0 && (
                            <p className="text-sm text-center py-2" style={{ color: currentTheme.styles.contentSecondary }}>
                                No tags available
                            </p>
                        )}

                        {/* Keyboard hints */}
                        <div
                            className="text-xs flex flex-wrap gap-x-4 gap-y-1 pt-2"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            <span>
                                <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>Tab</kbd> autocomplete
                            </span>
                            <span>
                                <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>Enter</kbd> add filter
                            </span>
                            <span>
                                <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>⌘ Enter</kbd> done
                            </span>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
