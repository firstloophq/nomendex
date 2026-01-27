/**
 * Simple event system for cross-component communication
 */

type RefreshEventType = "note" | "todo" | "notes-list" | "todos-list";

interface RefreshEventDetail {
    type: RefreshEventType;
    identifier?: string; // e.g., noteFileName or todoId
}

const REFRESH_EVENT = "app:refresh";

/**
 * Dispatch a refresh event to notify components to reload data
 */
export function dispatchRefresh(detail: RefreshEventDetail) {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail }));
}

/**
 * Subscribe to refresh events
 * Returns an unsubscribe function
 */
export function onRefresh(
    callback: (detail: RefreshEventDetail) => void,
    filter?: RefreshEventType | RefreshEventType[]
): () => void {
    const handler = (event: Event) => {
        const customEvent = event as CustomEvent<RefreshEventDetail>;
        const detail = customEvent.detail;

        // If filter specified, only call callback for matching types
        if (filter) {
            const filterArray = Array.isArray(filter) ? filter : [filter];
            if (!filterArray.includes(detail.type)) {
                return;
            }
        }

        callback(detail);
    };

    window.addEventListener(REFRESH_EVENT, handler);

    return () => {
        window.removeEventListener(REFRESH_EVENT, handler);
    };
}

// ============================================================================
// Type-Safe Event Bus
// ============================================================================

/**
 * Define all application events and their payload types here.
 * This provides type safety for both emitting and subscribing.
 */
export interface AppEventMap {
    // Navigation events
    "navigate:note": { fileName: string };
    "navigate:todo": { todoId: string };

    // Wiki link events
    "wikilink:click": { target: string; sourceNote?: string };

    // Tag events
    "tag:click": { tag: string; sourceNote?: string };

    // Workspace events
    "workspace:closeAllTabs": Record<string, never>;

    // Notes editor events
    "notes:copyMarkdown": { noteFileName: string };
    "notes:runSpellcheck": Record<string, never>;
    "notes:clearSpellcheck": Record<string, never>;
    "notes:openSearch": Record<string, never>;
}

type AppEventType = keyof AppEventMap;
type AppEventCallback<T extends AppEventType> = (payload: AppEventMap[T]) => void;

/**
 * Emit a typed event that any subscriber can listen to
 */
export function emit<T extends AppEventType>(eventType: T, payload: AppEventMap[T]): void {
    window.dispatchEvent(
        new CustomEvent(`app:${eventType}`, { detail: payload })
    );
}

/**
 * Subscribe to a typed event
 * Returns an unsubscribe function for cleanup
 *
 * @example
 * // In a useEffect:
 * useEffect(() => {
 *     return subscribe("wikilink:click", ({ target }) => {
 *         console.log("Wiki link clicked:", target);
 *     });
 * }, []);
 */
export function subscribe<T extends AppEventType>(
    eventType: T,
    callback: AppEventCallback<T>
): () => void {
    const handler = (event: Event) => {
        const customEvent = event as CustomEvent<AppEventMap[T]>;
        callback(customEvent.detail);
    };

    window.addEventListener(`app:${eventType}`, handler);

    return () => {
        window.removeEventListener(`app:${eventType}`, handler);
    };
}
