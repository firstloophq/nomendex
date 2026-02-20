import { useEffect, useRef } from "react";

// Module-level storage survives component unmounts
const scrollPositions = new Map<string, number>();

const DEBUG = typeof window !== "undefined" && window.localStorage.getItem("debug:scroll-persist") === "1";
function debugLog(...args: unknown[]) {
    if (DEBUG) console.log("[ScrollPersistence]", ...args);
}

/**
 * Hook to persist scroll position for a tab's scrollable container.
 *
 * Since Radix TabsContent unmounts inactive tabs, this hook:
 * - Saves scroll position to a module-level Map on every scroll event
 * - Restores position on mount using a settling window that handles async content
 * - Ignores scroll events during the restoration window to prevent overwrites
 *
 * @param tabId - The unique tab identifier
 * @returns A ref to attach to the scrollable container element
 */
export function useTabScrollPersistence(tabId: string) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const isRestoringRef = useRef(false);

    // Track scroll position continuously (but not during restoration)
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;

        const handleScroll = () => {
            if (isRestoringRef.current) return;
            const pos = element.scrollTop;
            scrollPositions.set(tabId, pos);
        };

        element.addEventListener("scroll", handleScroll);
        return () => element.removeEventListener("scroll", handleScroll);
    }, [tabId]);

    // Restore scroll position on mount with a settling window
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;

        const savedPosition = scrollPositions.get(tabId);
        debugLog(`mount tabId=${tabId} savedPosition=${savedPosition} scrollHeight=${element.scrollHeight} clientHeight=${element.clientHeight}`);

        if (savedPosition === undefined || savedPosition === 0) return;

        isRestoringRef.current = true;

        const restore = () => {
            if (element.scrollHeight > element.clientHeight) {
                element.scrollTop = savedPosition;
                debugLog(`restored tabId=${tabId} to=${savedPosition} scrollHeight=${element.scrollHeight}`);
            } else {
                debugLog(`skipped restore tabId=${tabId}: not scrollable yet (scrollHeight=${element.scrollHeight} clientHeight=${element.clientHeight})`);
            }
        };

        // Try immediately
        restore();

        // Try on next frame (after browser layout)
        requestAnimationFrame(() => restore());

        // Keep restoring on DOM mutations during the settling window.
        // This handles async content like chat history loading.
        const mutationObserver = new MutationObserver(() => restore());
        mutationObserver.observe(element, { childList: true, subtree: true });

        const resizeObserver = new ResizeObserver(() => restore());
        resizeObserver.observe(element);

        // End the settling window after 1.5s - stop restoring, resume saving
        const timeout = setTimeout(() => {
            debugLog(`settling window closed tabId=${tabId}, final scrollTop=${element.scrollTop}`);
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            isRestoringRef.current = false;
        }, 1500);

        return () => {
            clearTimeout(timeout);
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            isRestoringRef.current = false;
        };
    }, [tabId]);

    return scrollRef;
}

/**
 * Clear saved scroll position for a tab (e.g., when tab is closed)
 */
export function clearTabScrollPosition(tabId: string) {
    scrollPositions.delete(tabId);
}
