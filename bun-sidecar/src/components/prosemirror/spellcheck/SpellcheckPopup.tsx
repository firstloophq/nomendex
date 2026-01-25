import { useEffect, useState, useRef } from "react";
import { EditorView } from "prosemirror-view";
import { getSuggestions, spellcheckPluginKey } from "./index";
import { useTheme } from "@/hooks/useTheme";
import "./spellcheck.css";

interface SpellcheckPopupProps {
    view: EditorView;
    word: string;
    position: { top: number; left: number };
    onClose: () => void;
    onReplace: (replacement: string) => void;
}

export function SpellcheckPopup({ view, word, position, onClose, onReplace }: SpellcheckPopupProps) {
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const popupRef = useRef<HTMLDivElement>(null);
    const { currentTheme } = useTheme();

    useEffect(() => {
        // Get suggestions from the dictionary
        const pluginState = spellcheckPluginKey.getState(view.state);
        if (pluginState?.dictionary) {
            const sug = getSuggestions(word, pluginState.dictionary);
            setSuggestions(sug.slice(0, 5)); // Show top 5 suggestions
        }
    }, [view, word]);

    useEffect(() => {
        // Close popup when clicking outside
        function handleClickOutside(event: MouseEvent) {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                onClose();
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    useEffect(() => {
        // Close popup on Escape key
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    return (
        <div
            ref={popupRef}
            className="spellcheck-popup"
            style={{
                top: `${position.top}px`,
                left: `${position.left}px`,
                backgroundColor: currentTheme.styles.surfacePrimary,
                border: `1px solid ${currentTheme.styles.borderDefault}`,
            }}
        >
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
                            onClick={() => {
                                onReplace(suggestion);
                                onClose();
                            }}
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
        </div>
    );
}
