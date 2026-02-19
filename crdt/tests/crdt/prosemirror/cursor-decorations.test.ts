import { describe, expect, it } from "bun:test";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";
import {
  createCursorPlugin,
  updateRemoteCursors,
  awarenessToRemoteCursor,
  type RemoteCursor,
} from "@/crdt/prosemirror/cursor-decorations";
import type { AwarenessState } from "@/crdt/network/awareness";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
});

const listSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    text: { group: "inline" },
  },
});

function getDecorations(params: {
  state: EditorState;
  plugin: ReturnType<typeof createCursorPlugin>;
}): DecorationSet {
  const decorations = params.plugin.props.decorations?.(params.state);
  expect(decorations instanceof DecorationSet).toBe(true);
  expect(() => decorations!.find()).not.toThrow();
  return decorations!;
}

function applyCursorUpdate(params: {
  state: EditorState;
  cursors: ReadonlyMap<string, RemoteCursor>;
}): EditorState {
  const pluginState = params.state.plugins.find((plugin) =>
    plugin.key.includes("crdt-cursors"),
  );
  if (!pluginState) throw new Error("Cursor plugin missing");

  let updatedState = params.state;
  updateRemoteCursors({
    view: {
      state: params.state,
      dispatch: (tr) => {
        updatedState = params.state.apply(tr);
      },
    },
    cursors: params.cursors,
  });
  return updatedState;
}

describe("Cursor Decorations", () => {
  describe("createCursorPlugin", () => {
    it("creates a plugin with empty initial state", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      const state = EditorState.create({ schema, plugins: [plugin] });

      // Plugin state should exist
      expect(state).toBeDefined();
    });

    it("ignores non-cursor transactions", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      let state = EditorState.create({ schema, plugins: [plugin] });

      // Insert text — should not affect cursor decorations
      const tr = state.tr.insertText("hello", 1);
      state = state.apply(tr);

      // No errors, plugin handles doc changes gracefully
      expect(state.doc.textContent).toBe("hello");
    });
  });

  describe("awarenessToRemoteCursor", () => {
    it("converts awareness state to remote cursor", () => {
      const awarenessState: AwarenessState = {
        cursor: { anchor: 5, head: 5 },
        user: { name: "Bob", color: "#0000ff" },
        lastUpdated: Date.now(),
      };

      const cursor = awarenessToRemoteCursor({
        clientId: "B",
        state: awarenessState,
      });

      expect(cursor).not.toBeNull();
      expect(cursor!.clientId).toBe("B");
      expect(cursor!.cursor.anchor).toBe(5);
      expect(cursor!.cursor.head).toBe(5);
      expect(cursor!.user.name).toBe("Bob");
      expect(cursor!.user.color).toBe("#0000ff");
    });

    it("returns null when cursor is missing", () => {
      const awarenessState: AwarenessState = {
        viewingDocId: "card-123",
        user: { name: "Bob", color: "#0000ff" },
        lastUpdated: Date.now(),
      };

      const cursor = awarenessToRemoteCursor({
        clientId: "B",
        state: awarenessState,
      });

      expect(cursor).toBeNull();
    });
  });

  describe("updateRemoteCursors", () => {
    it("updates cursor decorations via dispatch", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      let state = EditorState.create({ schema, plugins: [plugin] });

      // Insert some text first
      state = state.apply(state.tr.insertText("hello world", 1));

      const cursors = new Map<string, RemoteCursor>();
      cursors.set("B", {
        clientId: "B",
        cursor: { anchor: 3, head: 3 },
        user: { name: "Bob", color: "#0000ff" },
      });

      // Use dispatch pattern to update
      let updatedState = state;
      updateRemoteCursors({
        view: {
          state,
          dispatch: (tr) => {
            updatedState = state.apply(tr);
          },
        },
        cursors,
      });

      // State should have been updated
      expect(updatedState).not.toBe(state);
    });
  });

  describe("multiple remote cursors", () => {
    it("handles multiple remote clients", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      let state = EditorState.create({ schema, plugins: [plugin] });

      state = state.apply(state.tr.insertText("hello world", 1));

      const cursors = new Map<string, RemoteCursor>();
      cursors.set("B", {
        clientId: "B",
        cursor: { anchor: 3, head: 3 },
        user: { name: "Bob", color: "#0000ff" },
      });
      cursors.set("C", {
        clientId: "C",
        cursor: { anchor: 7, head: 7 },
        user: { name: "Charlie", color: "#00ff00" },
      });

      let updatedState = state;
      updateRemoteCursors({
        view: {
          state,
          dispatch: (tr) => {
            updatedState = state.apply(tr);
          },
        },
        cursors,
      });

      expect(updatedState).not.toBe(state);
    });
  });

  describe("selection highlight", () => {
    it("handles cursors with selection range (anchor !== head)", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      let state = EditorState.create({ schema, plugins: [plugin] });

      state = state.apply(state.tr.insertText("hello world", 1));

      const cursors = new Map<string, RemoteCursor>();
      cursors.set("B", {
        clientId: "B",
        cursor: { anchor: 3, head: 8 }, // selection range
        user: { name: "Bob", color: "#0000ff" },
      });

      let updatedState = state;
      updateRemoteCursors({
        view: {
          state,
          dispatch: (tr) => {
            updatedState = state.apply(tr);
          },
        },
        cursors,
      });

      // Should not throw, decorations should be created
      expect(updatedState).not.toBe(state);
    });
  });

  describe("regression: rapid checkbox typing", () => {
    it("keeps cursor decorations valid while typing [] key-by-key", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      let state = EditorState.create({ schema: listSchema, plugins: [plugin] });

      const remote = new Map<string, RemoteCursor>();
      remote.set("B", {
        clientId: "B",
        cursor: { anchor: 1, head: 1 },
        user: { name: "Bob", color: "#0000ff" },
      });

      state = applyCursorUpdate({ state, cursors: remote });
      getDecorations({ state, plugin });

      let cursorPos = 1;
      for (const char of "[]") {
        state = state.apply(state.tr.insertText(char, cursorPos, cursorPos));
        cursorPos += 1;

        remote.set("B", {
          clientId: "B",
          cursor: { anchor: cursorPos, head: cursorPos },
          user: { name: "Bob", color: "#0000ff" },
        });
        state = applyCursorUpdate({ state, cursors: remote });
        getDecorations({ state, plugin });
      }
    });

    it("remains interactive through paragraph-to-list reflow while typing - [ ]", () => {
      const plugin = createCursorPlugin({ localClientId: "A" });
      let state = EditorState.create({ schema: listSchema, plugins: [plugin] });

      const remote = new Map<string, RemoteCursor>();
      remote.set("B", {
        clientId: "B",
        cursor: { anchor: 1, head: 1 },
        user: { name: "Bob", color: "#0000ff" },
      });
      state = applyCursorUpdate({ state, cursors: remote });

      let pos = 1;
      for (const char of "- [ ]") {
        state = state.apply(state.tr.insertText(char, pos, pos));
        pos += 1;

        remote.set("B", {
          clientId: "B",
          cursor: { anchor: pos, head: pos },
          user: { name: "Bob", color: "#0000ff" },
        });
        state = applyCursorUpdate({ state, cursors: remote });
        getDecorations({ state, plugin });
      }

      const paragraphText = state.doc.textContent;
      const reflowDoc = listSchema.nodes["doc"]!.create(null, [
        listSchema.nodes["bullet_list"]!.create(null, [
          listSchema.nodes["list_item"]!.create(null, [
            listSchema.nodes["paragraph"]!.create(null, [listSchema.text(paragraphText)]),
          ]),
        ]),
      ]);

      state = state.apply(state.tr.replaceWith(0, state.doc.content.size, reflowDoc.content));

      remote.set("B", {
        clientId: "B",
        cursor: { anchor: state.doc.content.size + 50, head: state.doc.content.size + 50 },
        user: { name: "Bob", color: "#0000ff" },
      });
      state = applyCursorUpdate({ state, cursors: remote });

      const decorations = getDecorations({ state, plugin });
      expect(() => decorations.map(state.tr.mapping, state.doc)).not.toThrow();

      // Editor remains usable after reflow + cursor updates.
      state = state.apply(state.tr.insertText("x", 1, 1));
      expect(state.doc.textContent.includes("x")).toBe(true);
    });
  });
});
