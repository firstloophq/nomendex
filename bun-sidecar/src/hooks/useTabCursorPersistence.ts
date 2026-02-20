import { useEffect, useRef, useCallback } from "react";
import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";

interface CursorPosition {
    anchor: number;
    head: number;
}

// Module-level storage survives component unmounts
const cursorPositions = new Map<string, CursorPosition>();

const DEBUG = typeof window !== "undefined" && window.localStorage.getItem("debug:cursor-persist") === "1";
function debugLog(...args: unknown[]) {
    if (DEBUG) console.log("[CursorPersist]", ...args);
}

/**
 * Hook to persist cursor/selection position for a tab's ProseMirror editor.
 * Saves position on selection changes, restores when editor is ready.
 *
 * @param tabId - The unique tab identifier
 * @returns Object with save/restore functions to call from the editor
 */
export function useTabCursorPersistence(tabId: string) {
    const hasRestoredRef = useRef(false);

    // Save current selection
    const saveCursor = useCallback((view: EditorView) => {
        const { anchor, head } = view.state.selection;
        cursorPositions.set(tabId, { anchor, head });
        debugLog(`Saved cursor for ${tabId}: anchor=${anchor}, head=${head}`);
    }, [tabId]);

    // Restore selection - call this after editor content is loaded
    const restoreCursor = useCallback((view: EditorView) => {
        if (hasRestoredRef.current) {
            debugLog(`Already restored cursor for ${tabId}, skipping`);
            return;
        }

        const saved = cursorPositions.get(tabId);
        debugLog(`Attempting to restore cursor for ${tabId}:`, saved);

        if (!saved) {
            debugLog(`No saved cursor for ${tabId}`);
            hasRestoredRef.current = true;
            return;
        }

        try {
            const { doc } = view.state;
            const maxPos = doc.content.size;

            // Clamp positions to valid range
            const anchor = Math.min(saved.anchor, maxPos);
            const head = Math.min(saved.head, maxPos);

            debugLog(`Restoring cursor: anchor=${anchor}, head=${head} (max=${maxPos})`);

            const selection = TextSelection.create(doc, anchor, head);
            const tr = view.state.tr.setSelection(selection);
            view.dispatch(tr);

            hasRestoredRef.current = true;
            debugLog(`Cursor restored successfully`);
        } catch (error) {
            console.error(`[CursorPersist] Failed to restore cursor:`, error);
            hasRestoredRef.current = true;
        }
    }, [tabId]);

    // Reset the restored flag when tabId changes (new tab)
    useEffect(() => {
        hasRestoredRef.current = false;
        debugLog(`Reset restored flag for ${tabId}`);

        return () => {
            debugLog(`Cleanup for ${tabId}, saved position:`, cursorPositions.get(tabId));
        };
    }, [tabId]);

    return { saveCursor, restoreCursor };
}

/**
 * Clear saved cursor position for a tab (e.g., when tab is closed)
 */
export function clearTabCursorPosition(tabId: string) {
    cursorPositions.delete(tabId);
}
