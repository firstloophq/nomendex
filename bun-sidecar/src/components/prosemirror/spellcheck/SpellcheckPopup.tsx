import { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { EditorView } from "prosemirror-view";
import { getSuggestions, spellcheckPluginKey } from "./index";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "sonner";
import "./spellcheck.css";

interface SpellcheckPopupProps {
    view: EditorView;
}

interface PopupState {
    word: string;
    wordRect: { top: number; bottom: number; left: number; height: number };
    editorRect: { top: number; left: number };
    from: number;
    to: number;
}

export function SpellcheckPopup({ view }: SpellcheckPopupProps) {
    const [popup, setPopup] = useState<PopupState | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showAbove, setShowAbove] = useState(false);
    const popupRef = useRef<HTMLDivElement>(null);
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { currentTheme } = useTheme();

    const clearHideTimeout = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
        }
    }, []);

    const scheduleHide = useCallback(() => {
        clearHideTimeout();
        hideTimeoutRef.current = setTimeout(() => {
            setPopup(null);
        }, 200);
    }, [clearHideTimeout]);

    // Check if popup should show above after it renders
    useLayoutEffect(() => {
        if (!popup || !popupRef.current) {
            setShowAbove(false);
            return;
        }

        const popupHeight = popupRef.current.offsetHeight;
        const spaceBelow = window.innerHeight - popup.wordRect.bottom;
        const spaceAbove = popup.wordRect.top;

        // Show above if not enough space below but enough above
        if (spaceBelow < popupHeight + 10 && spaceAbove > popupHeight + 10) {
            setShowAbove(true);
        } else {
            setShowAbove(false);
        }
    }, [popup, suggestions]);

    // Handle mouse events on misspelled words
    useEffect(() => {
        const editorDom = view.dom;

        const handleMouseEnter = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.classList.contains("misspelled-word")) return;

            clearHideTimeout();

            const word = target.getAttribute("data-word");
            if (!word) return;

            const rect = target.getBoundingClientRect();
            const editorRect = editorDom.getBoundingClientRect();

            // Find the position in the document
            const pos = view.posAtCoords({ left: rect.left, top: rect.top });
            if (!pos) return;

            // Get suggestions
            const pluginState = spellcheckPluginKey.getState(view.state);
            if (pluginState?.dictionary) {
                const sug = getSuggestions(word, pluginState.dictionary);
                setSuggestions(sug.slice(0, 5));
            }

            setPopup({
                word,
                wordRect: {
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                    height: rect.height,
                },
                editorRect: {
                    top: editorRect.top,
                    left: editorRect.left,
                },
                from: pos.pos,
                to: pos.pos + word.length,
            });
        };

        const handleMouseLeave = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.classList.contains("misspelled-word")) return;

            // Check if we're moving to the popup
            const relatedTarget = event.relatedTarget as HTMLElement;
            if (popupRef.current?.contains(relatedTarget)) {
                return;
            }

            scheduleHide();
        };

        editorDom.addEventListener("mouseenter", handleMouseEnter, true);
        editorDom.addEventListener("mouseleave", handleMouseLeave, true);

        return () => {
            editorDom.removeEventListener("mouseenter", handleMouseEnter, true);
            editorDom.removeEventListener("mouseleave", handleMouseLeave, true);
            clearHideTimeout();
        };
    }, [view, clearHideTimeout, scheduleHide]);

    // Handle popup hover
    const handlePopupMouseEnter = useCallback(() => {
        clearHideTimeout();
    }, [clearHideTimeout]);

    const handlePopupMouseLeave = useCallback(() => {
        scheduleHide();
    }, [scheduleHide]);

    // Handle clicking a suggestion
    const handleReplace = useCallback(
        (suggestion: string) => {
            if (!popup) return;

            const { state, dispatch } = view;

            // Find the exact position of the misspelled word
            let wordFrom = -1;
            let wordTo = -1;

            state.doc.descendants((node, pos) => {
                if (wordFrom !== -1) return false; // Already found
                if (!node.isText) return;

                const text = node.text || "";
                const wordIndex = text.indexOf(popup.word);
                if (wordIndex !== -1) {
                    wordFrom = pos + wordIndex;
                    wordTo = wordFrom + popup.word.length;
                    return false;
                }
            });

            if (wordFrom === -1) return;

            // Replace the word and remove the decoration
            const tr = state.tr.replaceWith(
                wordFrom,
                wordTo,
                state.schema.text(suggestion)
            );
            // Tell the spellcheck plugin to remove the decoration at this position
            tr.setMeta(spellcheckPluginKey, {
                type: "removeAt",
                from: wordFrom,
                to: wordTo,
            });
            dispatch(tr);
            setPopup(null);
        },
        [view, popup]
    );

    // Handle adding word to dictionary
    const handleAddToDictionary = useCallback(async () => {
        if (!popup) return;

        const pluginState = spellcheckPluginKey.getState(view.state);
        if (!pluginState?.dictionary) return;

        const success = await pluginState.dictionary.addToUserDictionary(popup.word);
        if (success) {
            toast.success(`Added "${popup.word}" to dictionary`);

            // Remove the decoration for this word
            const { state, dispatch } = view;

            // Find all occurrences of this word and remove their decorations
            let wordFrom = -1;
            let wordTo = -1;

            state.doc.descendants((node, pos) => {
                if (!node.isText) return;
                const text = node.text || "";
                const wordIndex = text.indexOf(popup.word);
                if (wordIndex !== -1 && wordFrom === -1) {
                    wordFrom = pos + wordIndex;
                    wordTo = wordFrom + popup.word.length;
                }
            });

            if (wordFrom !== -1) {
                const tr = state.tr;
                tr.setMeta(spellcheckPluginKey, {
                    type: "removeAt",
                    from: wordFrom,
                    to: wordTo,
                });
                dispatch(tr);
            }

            setPopup(null);
        } else {
            toast.error("Failed to add word to dictionary");
        }
    }, [view, popup]);

    if (!popup) return null;

    // Calculate position relative to editor
    const popupTop = showAbove
        ? popup.wordRect.top - popup.editorRect.top - (popupRef.current?.offsetHeight ?? 0) - 4
        : popup.wordRect.bottom - popup.editorRect.top + 4;
    const popupLeft = popup.wordRect.left - popup.editorRect.left;

    return (
        <div
            ref={popupRef}
            className="spellcheck-popup"
            style={{
                top: `${popupTop}px`,
                left: `${popupLeft}px`,
                backgroundColor: currentTheme.styles.surfacePrimary,
                border: `1px solid ${currentTheme.styles.borderDefault}`,
            }}
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
        >
            <div className="spellcheck-popup-header" style={{ color: currentTheme.styles.contentTertiary }}>
                {popup.word}
            </div>
            <div className="spellcheck-popup-content">
                {suggestions.length > 0 ? (
                    suggestions.map((suggestion, index) => (
                        <div
                            key={index}
                            className="spellcheck-suggestion"
                            style={{
                                color: currentTheme.styles.contentPrimary,
                                backgroundColor: currentTheme.styles.surfacePrimary,
                            }}
                            onClick={() => handleReplace(suggestion)}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = currentTheme.styles.surfacePrimary;
                            }}
                        >
                            {suggestion}
                        </div>
                    ))
                ) : (
                    <div
                        className="spellcheck-no-suggestions"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        No suggestions
                    </div>
                )}
            </div>
            <div
                className="spellcheck-add-to-dict"
                style={{
                    color: currentTheme.styles.contentSecondary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
                onClick={handleAddToDictionary}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = currentTheme.styles.surfaceAccent;
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                }}
            >
                Add to dictionary
            </div>
        </div>
    );
}
