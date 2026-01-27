import { useEffect, useRef } from "react";

// Module-level storage survives component unmounts
const scrollPositions = new Map<string, number>();

/**
 * Hook to persist scroll position for a tab's scrollable container.
 * Saves position on every scroll event, restores when content becomes scrollable.
 *
 * @param tabId - The unique tab identifier
 * @returns A ref to attach to the scrollable container element
 */
export function useTabScrollPersistence(tabId: string) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const hasRestoredRef = useRef(false);

    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;

        hasRestoredRef.current = false;
        const savedPosition = scrollPositions.get(tabId);

        // Save scroll position on EVERY scroll event (not just cleanup)
        const handleScroll = () => {
            const currentScroll = element.scrollTop;
            scrollPositions.set(tabId, currentScroll);
        };

        element.addEventListener("scroll", handleScroll);

        // Function to attempt scroll restoration
        const tryRestore = () => {
            if (hasRestoredRef.current) return;
            if (savedPosition === undefined || savedPosition === 0) {
                hasRestoredRef.current = true;
                return;
            }

            // Only restore if the element is actually scrollable
            if (element.scrollHeight > element.clientHeight) {
                element.scrollTop = savedPosition;
                hasRestoredRef.current = true;
            }
        };

        // Try immediately
        tryRestore();

        // Watch for content changes that make the element scrollable
        const observer = new ResizeObserver(() => {
            tryRestore();
        });
        observer.observe(element);

        // Also observe children being added (for async content)
        const mutationObserver = new MutationObserver(() => {
            tryRestore();
        });
        mutationObserver.observe(element, { childList: true, subtree: true });

        // Cleanup
        return () => {
            element.removeEventListener("scroll", handleScroll);
            observer.disconnect();
            mutationObserver.disconnect();
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
