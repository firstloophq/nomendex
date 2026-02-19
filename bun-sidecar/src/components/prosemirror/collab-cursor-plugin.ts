import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";

export interface CollabCursorAwarenessState {
    readonly cursor?: { anchor: number; head: number };
    readonly user: { name: string; color: string };
}

export interface RemoteCursor {
    readonly clientId: string;
    readonly cursor: { anchor: number; head: number };
    readonly user: { name: string; color: string };
}

interface CursorDecorationState {
    readonly cursors: ReadonlyMap<string, RemoteCursor>;
    readonly decorations: DecorationSet;
}

const CURSOR_PLUGIN_KEY = new PluginKey<CursorDecorationState>("nomendex-cursors");
const UPDATE_CURSORS_META = "nomendex-update-cursors";

const DEFAULT_CURSOR_STATE: CursorDecorationState = {
    cursors: new Map(),
    decorations: DecorationSet.empty,
};

export function createCollabCursorPlugin(params: { localClientId: string }): Plugin<CursorDecorationState> {
    return new Plugin<CursorDecorationState>({
        key: CURSOR_PLUGIN_KEY,

        state: {
            init() {
                return DEFAULT_CURSOR_STATE;
            },

            apply(tr, pluginState): CursorDecorationState {
                const safePluginState = pluginState ?? DEFAULT_CURSOR_STATE;
                const newCursors = tr.getMeta(UPDATE_CURSORS_META) as
                    | ReadonlyMap<string, RemoteCursor>
                    | undefined;

                if (newCursors) {
                    return {
                        cursors: newCursors,
                        decorations: buildDecorations({
                            doc: tr.doc,
                            cursors: newCursors,
                            localClientId: params.localClientId,
                        }),
                    };
                }

                if (tr.docChanged) {
                    let mappedDecorations: DecorationSet;
                    try {
                        mappedDecorations = safePluginState.decorations.map(tr.mapping, tr.doc);
                    } catch {
                        mappedDecorations = buildDecorations({
                            doc: tr.doc,
                            cursors: safePluginState.cursors,
                            localClientId: params.localClientId,
                        });
                    }

                    return {
                        cursors: safePluginState.cursors,
                        decorations: mappedDecorations,
                    };
                }

                return safePluginState;
            },
        },

        props: {
            decorations(state) {
                const decorations = CURSOR_PLUGIN_KEY.getState(state)?.decorations;
                return decorations instanceof DecorationSet ? decorations : DecorationSet.empty;
            },
        },
    });
}

export function updateCollabRemoteCursors(params: {
    view: Pick<EditorView, "state" | "dispatch">;
    cursors: ReadonlyMap<string, RemoteCursor>;
}): void {
    const tr = params.view.state.tr.setMeta(UPDATE_CURSORS_META, params.cursors);
    params.view.dispatch(tr);
}

export function awarenessToRemoteCursor(params: {
    clientId: string;
    state: CollabCursorAwarenessState;
}): RemoteCursor | null {
    const awarenessState = params.state;
    if (!awarenessState?.cursor) return null;
    if (
        typeof awarenessState.cursor.anchor !== "number" ||
        typeof awarenessState.cursor.head !== "number" ||
        !Number.isFinite(awarenessState.cursor.anchor) ||
        !Number.isFinite(awarenessState.cursor.head)
    ) {
        return null;
    }
    if (
        !awarenessState.user ||
        typeof awarenessState.user.name !== "string" ||
        typeof awarenessState.user.color !== "string"
    ) {
        return null;
    }

    return {
        clientId: params.clientId,
        cursor: awarenessState.cursor,
        user: awarenessState.user,
    };
}

function buildDecorations(params: {
    doc: EditorState["doc"];
    cursors: ReadonlyMap<string, RemoteCursor>;
    localClientId: string;
}): DecorationSet {
    const decorations: Decoration[] = [];
    const docSize = params.doc.content.size;

    for (const [clientId, cursor] of params.cursors) {
        if (clientId === params.localClientId) continue;
        if (!isValidRemoteCursor(cursor)) continue;

        const pos = clampPosition(cursor.cursor.head, docSize);
        if (pos === null) continue;

        try {
            decorations.push(
                Decoration.widget(pos, () => {
                    const cursorEl = document.createElement("span");
                    cursorEl.className = "crdt-remote-cursor";
                    cursorEl.style.borderLeft = `2px solid ${cursor.user.color}`;
                    cursorEl.style.marginLeft = "-1px";
                    cursorEl.style.position = "relative";
                    cursorEl.style.pointerEvents = "none";

                    const label = document.createElement("span");
                    label.className = "crdt-remote-cursor-label";
                    label.textContent = cursor.user.name;
                    label.style.position = "absolute";
                    label.style.top = "-1.4em";
                    label.style.left = "-1px";
                    label.style.fontSize = "10px";
                    label.style.lineHeight = "1";
                    label.style.padding = "1px 4px";
                    label.style.borderRadius = "3px";
                    label.style.backgroundColor = cursor.user.color;
                    label.style.color = "white";
                    label.style.whiteSpace = "nowrap";
                    label.style.userSelect = "none";
                    cursorEl.appendChild(label);

                    return cursorEl;
                }, { side: 1 }),
            );
        } catch {
            continue;
        }

        if (cursor.cursor.anchor !== cursor.cursor.head) {
            const from = Math.min(cursor.cursor.anchor, cursor.cursor.head);
            const to = Math.max(cursor.cursor.anchor, cursor.cursor.head);
            const clampedFrom = clampPosition(from, docSize);
            const clampedTo = clampPosition(to, docSize);

            if (clampedFrom !== null && clampedTo !== null && clampedFrom < clampedTo) {
                try {
                    decorations.push(
                        Decoration.inline(clampedFrom, clampedTo, {
                            style: `background-color: ${cursor.user.color}33;`,
                        }),
                    );
                } catch {
                    // Ignore malformed ranges from stale cursor payloads.
                }
            }
        }
    }

    return DecorationSet.create(params.doc, decorations);
}

function clampPosition(pos: number, max: number): number | null {
    if (!Number.isFinite(pos)) return null;
    return Math.max(0, Math.min(Math.trunc(pos), max));
}

function isValidRemoteCursor(value: unknown): value is RemoteCursor {
    if (!value || typeof value !== "object") return false;

    const maybeCursor = value as Partial<RemoteCursor> & {
        cursor?: { anchor?: unknown; head?: unknown };
        user?: { name?: unknown; color?: unknown };
    };

    return Boolean(
        maybeCursor.cursor &&
        typeof maybeCursor.cursor.anchor === "number" &&
        typeof maybeCursor.cursor.head === "number" &&
        maybeCursor.user &&
        typeof maybeCursor.user.name === "string" &&
        typeof maybeCursor.user.color === "string",
    );
}
