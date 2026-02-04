import { useEffect, useRef } from "react";

/**
 * Registry for ProseMirror editors that want to handle Cmd+Enter.
 * Each editor can register a callback that will be called when Cmd+Enter is pressed
 * and that editor has focus.
 */
type ProseMirrorCmdEnterHandler = () => boolean;
const proseMirrorCmdEnterHandlers = new Map<HTMLElement, ProseMirrorCmdEnterHandler>();

/**
 * Register a ProseMirror editor to handle Cmd+Enter.
 * The callback should return true if it handled the event.
 */
export function registerProseMirrorCmdEnter(
    element: HTMLElement,
    handler: ProseMirrorCmdEnterHandler
): () => void {
    proseMirrorCmdEnterHandlers.set(element, handler);
    return () => {
        proseMirrorCmdEnterHandlers.delete(element);
    };
}

/**
 * Try to handle Cmd+Enter by finding a registered ProseMirror handler
 * for the currently focused editor.
 * Returns true if a handler was found and handled the event.
 */
function tryProseMirrorCmdEnter(): boolean {
    const activeElement = document.activeElement as HTMLElement | null;
    if (!activeElement) return false;

    // Find the ProseMirror editor containing the active element
    const proseMirrorEditor = activeElement.closest('.ProseMirror[contenteditable="true"]');
    if (!proseMirrorEditor) return false;

    // Check if we have a registered handler for this editor
    const handler = proseMirrorCmdEnterHandlers.get(proseMirrorEditor as HTMLElement);
    if (handler) {
        return handler();
    }

    return false;
}

/**
 * Hook for components that want to respond to Cmd+Enter from the native Mac app.
 *
 * Usage:
 * ```tsx
 * useNativeSubmit(() => {
 *     if (isValid && !loading) {
 *         handleSubmit();
 *     }
 * });
 * ```
 */
export function useNativeSubmit(onSubmit: () => void) {
    // Store onSubmit in a ref to avoid re-subscribing on every render
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;

    useEffect(() => {
        const handleNativeSubmit = () => {
            onSubmitRef.current();
        };

        window.addEventListener("nativeSubmit", handleNativeSubmit);
        return () => window.removeEventListener("nativeSubmit", handleNativeSubmit);
    }, []);
}

/**
 * Global keyboard bridge for native Mac app.
 *
 * This hook registers global functions that Swift can call to handle
 * keyboard navigation that WKWebView doesn't forward properly.
 *
 * Should be called once at the app root level.
 */
export function useNativeKeyboardBridge() {
    useEffect(() => {
        // Intercept nativeSubmit events to try ProseMirror handlers first
        // Swift dispatches CustomEvent('nativeSubmit') directly for Cmd+Enter
        // This listener runs early (app initialization) so it's first in queue
        const handleNativeSubmitIntercept = (event: Event) => {
            if (tryProseMirrorCmdEnter()) {
                // ProseMirror handled it (e.g., todo toggle), don't let dialogs also handle
                event.stopImmediatePropagation();
                event.preventDefault();
            }
            // Otherwise, let event propagate to dialog handlers via useNativeSubmit
        };

        window.addEventListener('nativeSubmit', handleNativeSubmitIntercept);

        // Get all focusable elements in the document, respecting tab order
        const getFocusableElements = (): HTMLElement[] => {
            const selector = [
                'a[href]:not([disabled]):not([tabindex="-1"])',
                'button:not([disabled]):not([tabindex="-1"])',
                'input:not([disabled]):not([tabindex="-1"])',
                'select:not([disabled]):not([tabindex="-1"])',
                'textarea:not([disabled]):not([tabindex="-1"])',
                '[tabindex]:not([tabindex="-1"]):not([disabled])',
                '[contenteditable="true"]:not([disabled])',
            ].join(', ');

            const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));

            // Filter to only visible elements
            return elements.filter(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' &&
                       style.visibility !== 'hidden' &&
                       style.opacity !== '0' &&
                       el.offsetParent !== null;
            });
        };

        // Check if focus is in a ProseMirror editor (contenteditable)
        // If so, dispatch a Tab event instead of moving focus
        const isInProseMirrorEditor = (): HTMLElement | null => {
            const activeElement = document.activeElement as HTMLElement | null;
            if (!activeElement) return null;

            // Check if active element or its parent is a ProseMirror contenteditable
            const proseMirrorEditor = activeElement.closest('.ProseMirror[contenteditable="true"]');
            return proseMirrorEditor as HTMLElement | null;
        };

        // Dispatch a synthetic Tab key event to an element
        const dispatchTabEvent = (element: HTMLElement, shiftKey: boolean) => {
            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                code: 'Tab',
                keyCode: 9,
                which: 9,
                shiftKey,
                bubbles: true,
                cancelable: true,
            });
            element.dispatchEvent(event);
        };

        // Focus the next focusable element
        const focusNext = () => {
            // If in ProseMirror editor, dispatch Tab event for indentation
            const editor = isInProseMirrorEditor();
            if (editor) {
                dispatchTabEvent(editor, false);
                return;
            }

            const focusable = getFocusableElements();
            if (focusable.length === 0) return;

            const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % focusable.length;
            focusable[nextIndex]?.focus();
        };

        // Focus the previous focusable element
        const focusPrevious = () => {
            // If in ProseMirror editor, dispatch Shift-Tab event for outdentation
            const editor = isInProseMirrorEditor();
            if (editor) {
                dispatchTabEvent(editor, true);
                return;
            }

            const focusable = getFocusableElements();
            if (focusable.length === 0) return;

            const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
            const prevIndex = currentIndex === -1 ? focusable.length - 1 : (currentIndex - 1 + focusable.length) % focusable.length;
            focusable[prevIndex]?.focus();
        };

        // Switch to next tab (Ctrl+Tab) - dispatch synthetic event for keybinding system
        // Note: Must dispatch on document since useKeybindings listens on document, not window
        const nextTab = () => {
            console.log('__nativeNextTab called, dispatching Ctrl+Tab event to document');
            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                code: 'Tab',
                ctrlKey: true,
                shiftKey: false,
                bubbles: true,
                cancelable: true,
            });
            document.dispatchEvent(event);
            console.log('Ctrl+Tab event dispatched to document');
        };

        // Switch to previous tab (Ctrl+Shift+Tab) - dispatch synthetic event for keybinding system
        const prevTab = () => {
            console.log('__nativePrevTab called, dispatching Ctrl+Shift+Tab event to document');
            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                code: 'Tab',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            });
            document.dispatchEvent(event);
            console.log('Ctrl+Shift+Tab event dispatched to document');
        };

        // Handle Cmd+Enter submit - try registered ProseMirror handlers first,
        // then fall back to custom event for dialogs
        const nativeSubmit = () => {
            console.log('__nativeSubmit called');

            // Try registered ProseMirror handlers first (for todo toggle, etc.)
            if (tryProseMirrorCmdEnter()) {
                console.log('ProseMirror Cmd+Enter handled by registered handler');
                return;
            }

            // Otherwise, dispatch custom event for dialogs using useNativeSubmit
            console.log('Dispatching nativeSubmit CustomEvent for dialogs');
            const event = new CustomEvent('nativeSubmit', { bubbles: true });
            window.dispatchEvent(event);
        };

        // Quick Capture trigger - dispatch custom event for QuickCaptureProvider
        const quickCapture = () => {
            console.log('__nativeQuickCapture called, dispatching event');
            document.dispatchEvent(new CustomEvent('nativeQuickCapture'));
        };

        // Register global functions for Swift to call
        const win = window as Window & {
            __nativeFocusNext?: () => void;
            __nativeFocusPrevious?: () => void;
            __nativeNextTab?: () => void;
            __nativePrevTab?: () => void;
            __nativeSubmit?: () => void;
            __nativeQuickCapture?: () => void;
        };

        win.__nativeFocusNext = focusNext;
        win.__nativeFocusPrevious = focusPrevious;
        win.__nativeNextTab = nextTab;
        win.__nativePrevTab = prevTab;
        win.__nativeSubmit = nativeSubmit;
        win.__nativeQuickCapture = quickCapture;

        return () => {
            window.removeEventListener('nativeSubmit', handleNativeSubmitIntercept);
            delete win.__nativeFocusNext;
            delete win.__nativeFocusPrevious;
            delete win.__nativeNextTab;
            delete win.__nativePrevTab;
            delete win.__nativeSubmit;
            delete win.__nativeQuickCapture;
        };
    }, []);
}
