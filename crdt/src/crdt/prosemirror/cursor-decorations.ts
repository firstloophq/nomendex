import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { AwarenessState } from "../network/awareness";
import type { ClientId } from "../core/client-id";

// --- Types ---

export interface RemoteCursor {
  readonly clientId: ClientId;
  readonly cursor: { anchor: number; head: number };
  readonly user: { name: string; color: string };
}

interface CursorDecorationState {
  readonly cursors: ReadonlyMap<ClientId, RemoteCursor>;
  readonly decorations: DecorationSet;
}

const CURSOR_PLUGIN_KEY = new PluginKey<CursorDecorationState>("crdt-cursors");
const UPDATE_CURSORS_META = "crdt-update-cursors";

// --- Plugin ---

export function createCursorPlugin(params: {
  localClientId: ClientId;
}): Plugin<CursorDecorationState> {
  return new Plugin<CursorDecorationState>({
    key: CURSOR_PLUGIN_KEY,

    state: {
      init() {
        return {
          cursors: new Map(),
          decorations: DecorationSet.empty,
        };
      },

      apply(tr, pluginState) {
        const newCursors = tr.getMeta(UPDATE_CURSORS_META) as
          | ReadonlyMap<ClientId, RemoteCursor>
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

        // If the doc changed, remap decorations
        if (tr.docChanged) {
          let mappedDecorations: DecorationSet;
          try {
            mappedDecorations = (
              pluginState.decorations as unknown as {
                map: (mapping: unknown, doc: unknown) => unknown;
              }
            ).map(tr.mapping, tr.doc) as DecorationSet;
          } catch {
            mappedDecorations = buildDecorations({
              doc: tr.doc,
              cursors: pluginState.cursors,
              localClientId: params.localClientId,
            });
          }

          return {
            cursors: pluginState.cursors,
            decorations: mappedDecorations,
          };
        }

        return pluginState;
      },
    },

    props: {
      decorations(state): any {
        const decorations = CURSOR_PLUGIN_KEY.getState(state)?.decorations;
        return isDecorationSet(decorations) ? decorations : DecorationSet.empty;
      },
    },
  });
}

// --- Public API ---

export function updateRemoteCursors(params: {
  view: { state: import("prosemirror-state").EditorState; dispatch: (tr: import("prosemirror-state").Transaction) => void };
  cursors: ReadonlyMap<ClientId, RemoteCursor>;
}): void {
  const tr = params.view.state.tr.setMeta(UPDATE_CURSORS_META, params.cursors);
  params.view.dispatch(tr);
}

export function awarenessToRemoteCursor(params: {
  clientId: ClientId;
  state: AwarenessState;
}): RemoteCursor | null {
  if (!params.state.cursor) return null;
  return {
    clientId: params.clientId,
    cursor: params.state.cursor,
    user: params.state.user,
  };
}

// --- Build decorations ---

function buildDecorations(params: {
  doc: import("prosemirror-model").Node;
  cursors: ReadonlyMap<ClientId, RemoteCursor>;
  localClientId: ClientId;
}): DecorationSet {
  const decorations: Array<Decoration> = [];
  const docSize = params.doc.content.size;

  for (const [clientId, cursor] of params.cursors) {
    if (clientId === params.localClientId) continue;
    if (!isValidRemoteCursor(cursor)) continue;

    const pos = clampPosition(cursor.cursor.head, docSize);
    if (pos === null) continue;

    try {
      // Cursor line widget
      decorations.push(
        Decoration.widget(pos, () => {
          const cursorEl = document.createElement("span");
          cursorEl.className = "crdt-remote-cursor";
          cursorEl.style.borderLeft = `2px solid ${cursor.user.color}`;
          cursorEl.style.marginLeft = "-1px";
          cursorEl.style.position = "relative";
          cursorEl.style.pointerEvents = "none";

          // Name label
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

    // Selection highlight (if anchor !== head)
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

function isDecorationSet(value: unknown): value is DecorationSet {
  return value instanceof DecorationSet;
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
