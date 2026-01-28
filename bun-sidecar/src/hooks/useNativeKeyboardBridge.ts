import { useEffect, useRef } from "react";

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

        // Dispatch a synthetic Cmd+Enter key event to an element
        const dispatchCmdEnterEvent = (element: HTMLElement) => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                metaKey: true, // Cmd key on Mac
                bubbles: true,
                cancelable: true,
            });
            element.dispatchEvent(event);
        };

        // Handle Cmd+Enter submit - if in ProseMirror, dispatch keyboard event,
        // otherwise dispatch custom event for dialogs
        const nativeSubmit = () => {
            console.log('__nativeSubmit called');

            // Check if focus is in a ProseMirror editor
            const editor = isInProseMirrorEditor();
            if (editor) {
                console.log('Dispatching Cmd+Enter KeyboardEvent to ProseMirror editor');
                dispatchCmdEnterEvent(editor);
                return;
            }

            // Otherwise, dispatch custom event for dialogs using useNativeSubmit
            console.log('Dispatching nativeSubmit CustomEvent for dialogs');
            const event = new CustomEvent('nativeSubmit', { bubbles: true });
            window.dispatchEvent(event);
        };

        // Register global functions for Swift to call
        const win = window as Window & {
            __nativeFocusNext?: () => void;
            __nativeFocusPrevious?: () => void;
            __nativeNextTab?: () => void;
            __nativePrevTab?: () => void;
            __nativeSubmit?: () => void;
        };

        win.__nativeFocusNext = focusNext;
        win.__nativeFocusPrevious = focusPrevious;
        win.__nativeNextTab = nextTab;
        win.__nativePrevTab = prevTab;
        win.__nativeSubmit = nativeSubmit;

        return () => {
            delete win.__nativeFocusNext;
            delete win.__nativeFocusPrevious;
            delete win.__nativeNextTab;
            delete win.__nativePrevTab;
            delete win.__nativeSubmit;
        };
    }, []);
}
