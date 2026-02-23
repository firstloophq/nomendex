import { describe, expect, it } from "bun:test";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { splitListItem } from "prosemirror-schema-list";
import {
  createCRDTPlugin,
  getCRDTState,
  applyRemoteOps,
  undoCommand,
  redoCommand,
} from "@/crdt/prosemirror/plugin";
import {
  createEmptyDocument,
  applyOperation,
  getDocumentText,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createOperationId,
  type Operation,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
  },
});

const listSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    bullet_list: { group: "block", content: "list_item+" },
    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: { order: { default: 1 } },
    },
    list_item: { content: "paragraph block*" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
  },
});

function findTextEndPos(params: { doc: PMNode; text: string }): number {
  let pos: number | null = null;
  params.doc.descendants((node, nodePos) => {
    if (pos !== null) return false;
    if (!node.isText || !node.text) return true;
    const idx = node.text.indexOf(params.text);
    if (idx === -1) return true;
    // `nodePos` points at the start token of the text node content.
    pos = nodePos + idx + params.text.length;
    return false;
  });
  if (pos === null) {
    throw new Error(`Text not found in doc: ${params.text}`);
  }
  return pos;
}

describe("crdtPlugin", () => {
  it("creates a plugin with initial CRDT state", () => {
    const emittedOps: Array<Operation> = [];
    const plugin = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => emittedOps.push(...ops),
    });

    const state = EditorState.create({
      schema,
      plugins: [plugin],
    });

    const crdtState = getCRDTState({ state, plugin });
    expect(crdtState).toBeDefined();
    expect(crdtState.clientId).toBe("A");
  });

  it("captures local edits as CRDT operations", () => {
    const emittedOps: Array<Operation> = [];
    const plugin = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => emittedOps.push(...ops),
    });

    let state = EditorState.create({
      schema,
      plugins: [plugin],
    });

    // Type "h" at position 1 (inside first paragraph)
    const tr = state.tr.insertText("h", 1, 1);
    state = state.apply(tr);

    expect(emittedOps.length).toBeGreaterThan(0);
    expect(emittedOps.some((op) => op.type === "insert")).toBe(true);
  });

  it("applies remote operations and updates PM state", () => {
    const emittedOps: Array<Operation> = [];
    const plugin = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => emittedOps.push(...ops),
    });

    let state = EditorState.create({
      schema,
      plugins: [plugin],
    });

    // Simulate remote ops: insert a paragraph and "hi"
    const remoteOps: Array<Operation> = [
      createInsertOp({
        id: makeId("B", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
      createInsertOp({
        id: makeId("B", 2),
        parentId: makeId("B", 1),
        side: "right",
        content: { type: "text", value: "h" },
      }),
      createInsertOp({
        id: makeId("B", 3),
        parentId: makeId("B", 2),
        side: "right",
        content: { type: "text", value: "i" },
      }),
    ];

    const result = applyRemoteOps({ state, plugin, ops: remoteOps });
    state = result.state;

    // Verify the PM doc now contains the remote text
    const crdtState = getCRDTState({ state, plugin });
    const text = getDocumentText({ doc: crdtState.doc });
    expect(text).toBe("hi");
  });

  it("two editors converge after syncing ops", () => {
    const opsFromA: Array<Operation> = [];
    const opsFromB: Array<Operation> = [];

    const pluginA = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => opsFromA.push(...ops),
    });

    const pluginB = createCRDTPlugin({
      clientId: "B",
      schema,
      onLocalOps: (ops) => opsFromB.push(...ops),
    });

    let stateA = EditorState.create({ schema, plugins: [pluginA] });
    let stateB = EditorState.create({ schema, plugins: [pluginB] });

    // A types "hello"
    let trA = stateA.tr.insertText("hello", 1, 1);
    stateA = stateA.apply(trA);

    // B types "world"
    let trB = stateB.tr.insertText("world", 1, 1);
    stateB = stateB.apply(trB);

    // Sync: A's ops → B, B's ops → A
    const resultB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: opsFromA });
    stateB = resultB.state;

    const resultA = applyRemoteOps({ state: stateA, plugin: pluginA, ops: opsFromB });
    stateA = resultA.state;

    // Both should have the same text content
    const textA = getDocumentText({ doc: getCRDTState({ state: stateA, plugin: pluginA }).doc });
    const textB = getDocumentText({ doc: getCRDTState({ state: stateB, plugin: pluginB }).doc });
    expect(textA).toBe(textB);
  });

  it("keeps equivalent PM trees after list bootstrap and list-boundary edits", () => {
    const opsFromA: Array<Operation> = [];

    const pluginA = createCRDTPlugin({
      clientId: "A",
      schema: listSchema,
      onLocalOps: (ops) => opsFromA.push(...ops),
    });

    const pluginB = createCRDTPlugin({
      clientId: "B",
      schema: listSchema,
    });

    let stateA = EditorState.create({ schema: listSchema, plugins: [pluginA] });
    let stateB = EditorState.create({ schema: listSchema, plugins: [pluginB] });

    // Simulate bootstrap-origin doc replacement from parsed markdown.
    const bootstrapDoc = listSchema.nodes["doc"]!.create(null, [
      listSchema.nodes["ordered_list"]!.create({ order: 2 }, [
        listSchema.nodes["list_item"]!.create(null, [
          listSchema.nodes["paragraph"]!.create(null, [listSchema.text("one")]),
        ]),
        listSchema.nodes["list_item"]!.create(null, [
          listSchema.nodes["paragraph"]!.create(null, [listSchema.text("two")]),
          listSchema.nodes["bullet_list"]!.create(null, [
            listSchema.nodes["list_item"]!.create(null, [
              listSchema.nodes["paragraph"]!.create(null, [listSchema.text("nested")]),
            ]),
          ]),
        ]),
      ]),
    ]);

    stateA = stateA.apply(
      stateA.tr.replaceWith(0, stateA.doc.content.size, bootstrapDoc.content),
    );
    expect(opsFromA.length).toBeGreaterThan(0);

    stateB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: opsFromA }).state;
    expect(stateA.doc.eq(stateB.doc)).toBe(true);
    expect(stateA.doc.child(0).type.name).toBe("ordered_list");
    expect(stateB.doc.child(0).type.name).toBe("ordered_list");
    expect(stateB.doc.child(0).attrs.order).toBe(2);

    const prevLen = opsFromA.length;
    const pos = findTextEndPos({ doc: stateA.doc, text: "one" });
    stateA = stateA.apply(stateA.tr.insertText("!", pos, pos));
    const deltaOps = opsFromA.slice(prevLen);
    expect(deltaOps.length).toBeGreaterThan(0);

    stateB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: deltaOps }).state;
    expect(stateA.doc.eq(stateB.doc)).toBe(true);
    expect(stateA.doc.child(0).type.name).toBe("ordered_list");
    expect(stateB.doc.child(0).type.name).toBe("ordered_list");
  });

  it("keeps bullet list type and valid structure after Enter split sync", () => {
    const opsFromA: Array<Operation> = [];

    const pluginA = createCRDTPlugin({
      clientId: "A",
      schema: listSchema,
      onLocalOps: (ops) => opsFromA.push(...ops),
    });

    const pluginB = createCRDTPlugin({
      clientId: "B",
      schema: listSchema,
    });

    let stateA = EditorState.create({ schema: listSchema, plugins: [pluginA] });
    let stateB = EditorState.create({ schema: listSchema, plugins: [pluginB] });

    const bootstrapDoc = listSchema.nodes["doc"]!.create(null, [
      listSchema.nodes["bullet_list"]!.create(null, [
        listSchema.nodes["list_item"]!.create(null, [
          listSchema.nodes["paragraph"]!.create(null, [listSchema.text("one")]),
        ]),
      ]),
    ]);

    stateA = stateA.apply(
      stateA.tr.replaceWith(0, stateA.doc.content.size, bootstrapDoc.content),
    );
    expect(opsFromA.length).toBeGreaterThan(0);

    stateB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: opsFromA }).state;
    expect(stateA.doc.eq(stateB.doc)).toBe(true);

    const prevLen = opsFromA.length;
    const splitPos = findTextEndPos({ doc: stateA.doc, text: "one" });
    stateA = stateA.apply(
      stateA.tr.setSelection(TextSelection.create(stateA.doc, splitPos)),
    );

    let splitTr = null;
    const splitHandled = splitListItem(listSchema.nodes["list_item"]!)(
      stateA,
      (tr) => {
        splitTr = tr;
      },
    );
    expect(splitHandled).toBe(true);
    expect(splitTr).not.toBeNull();

    stateA = stateA.apply(splitTr!);
    const deltaOps = opsFromA.slice(prevLen);
    expect(deltaOps.length).toBeGreaterThan(0);

    stateB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: deltaOps }).state;

    expect(() => stateA.doc.check()).not.toThrow();
    expect(() => stateB.doc.check()).not.toThrow();
    expect(stateA.doc.eq(stateB.doc)).toBe(true);

    const rootList = stateB.doc.child(0);
    expect(rootList.type.name).toBe("bullet_list");
    expect(rootList.childCount).toBe(2);
    expect(rootList.child(0)!.child(0)!.textContent).toBe("one");
    expect(rootList.child(1)!.child(0)!.type.name).toBe("paragraph");
    expect(rootList.child(1)!.child(0)!.textContent).toBe("");
  });

  it("keeps ordered list item order after bold content Enter split", () => {
    const opsFromA: Array<Operation> = [];

    const pluginA = createCRDTPlugin({
      clientId: "A",
      schema: listSchema,
      onLocalOps: (ops) => opsFromA.push(...ops),
    });

    const pluginB = createCRDTPlugin({
      clientId: "B",
      schema: listSchema,
    });

    let stateA = EditorState.create({ schema: listSchema, plugins: [pluginA] });
    let stateB = EditorState.create({ schema: listSchema, plugins: [pluginB] });

    const bootstrapDoc = listSchema.nodes["doc"]!.create(null, [
      listSchema.nodes["paragraph"]!.create(null, [
        listSchema.text("This is today. Right. This is pretty good?"),
      ]),
      listSchema.nodes["ordered_list"]!.create({ order: 1 }, [
        listSchema.nodes["list_item"]!.create(null, [
          listSchema.nodes["paragraph"]!.create(null, [
            listSchema.text("asdasfdf", [listSchema.mark("bold")!]),
          ]),
        ]),
      ]),
    ]);

    stateA = stateA.apply(
      stateA.tr.replaceWith(0, stateA.doc.content.size, bootstrapDoc.content),
    );
    expect(opsFromA.length).toBeGreaterThan(0);

    stateB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: opsFromA }).state;
    expect(stateA.doc.eq(stateB.doc)).toBe(true);

    const prevLen = opsFromA.length;
    const splitPos = findTextEndPos({ doc: stateA.doc, text: "asdasfdf" });
    stateA = stateA.apply(
      stateA.tr.setSelection(TextSelection.create(stateA.doc, splitPos)),
    );

    let splitTr = null;
    const splitHandled = splitListItem(listSchema.nodes["list_item"]!)(
      stateA,
      (tr) => {
        splitTr = tr;
      },
    );
    expect(splitHandled).toBe(true);
    expect(splitTr).not.toBeNull();

    stateA = stateA.apply(splitTr!);
    const deltaOps = opsFromA.slice(prevLen);
    expect(deltaOps.length).toBeGreaterThan(0);

    stateB = applyRemoteOps({ state: stateB, plugin: pluginB, ops: deltaOps }).state;

    expect(() => stateA.doc.check()).not.toThrow();
    expect(() => stateB.doc.check()).not.toThrow();
    expect(stateA.doc.eq(stateB.doc)).toBe(true);

    const orderedList = stateB.doc.child(1);
    expect(orderedList.type.name).toBe("ordered_list");
    expect(orderedList.childCount).toBe(2);
    expect(orderedList.child(0)!.child(0)!.textContent).toBe("asdasfdf");
    expect(orderedList.child(1)!.child(0)!.textContent).toBe("");
  });

  it("does not emit remote ops through onLocalOps", () => {
    const opsFromA: Array<Operation> = [];
    const localOpsFromB: Array<Operation> = [];

    const pluginA = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => opsFromA.push(...ops),
    });

    const pluginB = createCRDTPlugin({
      clientId: "B",
      schema,
      onLocalOps: (ops) => localOpsFromB.push(...ops),
    });

    let stateA = EditorState.create({ schema, plugins: [pluginA] });
    let stateB = EditorState.create({ schema, plugins: [pluginB] });

    // A types "hi"
    stateA = stateA.apply(stateA.tr.insertText("hi", 1, 1));

    // Apply to B
    applyRemoteOps({ state: stateB, plugin: pluginB, ops: opsFromA });

    // B's onLocalOps should not have been called
    expect(localOpsFromB.length).toBe(0);
  });
});

describe("undo/redo", () => {
  it("undo reverts local insert", () => {
    const emittedOps: Array<Operation> = [];
    const plugin = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => emittedOps.push(...ops),
    });

    let state = EditorState.create({ schema, plugins: [plugin] });

    // Type "hello"
    state = state.apply(state.tr.insertText("hello", 1, 1));
    expect(state.doc.textContent).toBe("hello");

    // Undo
    const undoResult = undoCommand({ state, plugin });
    expect(undoResult).not.toBeNull();
    state = undoResult!.state;

    expect(state.doc.textContent).toBe("");
    expect(getDocumentText({ doc: getCRDTState({ state, plugin }).doc })).toBe("");
  });

  it("redo restores undone changes", () => {
    const emittedOps: Array<Operation> = [];
    const plugin = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => emittedOps.push(...ops),
    });

    let state = EditorState.create({ schema, plugins: [plugin] });

    // Type "hello"
    state = state.apply(state.tr.insertText("hello", 1, 1));

    // Undo
    const undoResult = undoCommand({ state, plugin });
    state = undoResult!.state;
    expect(state.doc.textContent).toBe("");

    // Redo
    const redoResult = redoCommand({ state, plugin });
    expect(redoResult).not.toBeNull();
    state = redoResult!.state;

    // Text should be restored (content may differ from original due to new IDs)
    const crdtText = getDocumentText({ doc: getCRDTState({ state, plugin }).doc });
    expect(crdtText.length).toBeGreaterThan(0);
  });

  it("undo only affects the local client's operations", () => {
    const opsFromA: Array<Operation> = [];
    const opsFromB: Array<Operation> = [];

    const pluginA = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => opsFromA.push(...ops),
    });

    const pluginB = createCRDTPlugin({
      clientId: "B",
      schema,
      onLocalOps: (ops) => opsFromB.push(...ops),
    });

    let stateA = EditorState.create({ schema, plugins: [pluginA] });
    let stateB = EditorState.create({ schema, plugins: [pluginB] });

    // A types "AAA"
    stateA = stateA.apply(stateA.tr.insertText("AAA", 1, 1));

    // Sync A → B
    const syncResult = applyRemoteOps({ state: stateB, plugin: pluginB, ops: opsFromA });
    stateB = syncResult.state;

    // B types "BBB"
    stateB = stateB.apply(stateB.tr.insertText("BBB", 4, 4));

    // Sync B → A
    const syncResult2 = applyRemoteOps({ state: stateA, plugin: pluginA, ops: opsFromB });
    stateA = syncResult2.state;

    // Both should have "AAA" + "BBB" in some order
    const textBefore = getDocumentText({ doc: getCRDTState({ state: stateA, plugin: pluginA }).doc });
    expect(textBefore).toContain("AAA");
    expect(textBefore).toContain("BBB");

    // Undo on A should only undo A's "AAA"
    const undoResult = undoCommand({ state: stateA, plugin: pluginA });
    expect(undoResult).not.toBeNull();
    stateA = undoResult!.state;

    const textAfter = getDocumentText({ doc: getCRDTState({ state: stateA, plugin: pluginA }).doc });
    expect(textAfter).not.toContain("AAA");
    expect(textAfter).toContain("BBB");
  });

  it("undo emits inverse operations through onLocalOps", () => {
    const emittedOps: Array<Operation> = [];
    const plugin = createCRDTPlugin({
      clientId: "A",
      schema,
      onLocalOps: (ops) => emittedOps.push(...ops),
    });

    let state = EditorState.create({ schema, plugins: [plugin] });

    // Type "hi"
    state = state.apply(state.tr.insertText("hi", 1, 1));
    const opsBeforeUndo = emittedOps.length;

    // Undo — should emit delete operations
    const undoResult = undoCommand({ state, plugin });
    state = undoResult!.state;

    expect(emittedOps.length).toBeGreaterThan(opsBeforeUndo);
    // The new ops should be delete ops (inverses of the inserts)
    const undoOps = emittedOps.slice(opsBeforeUndo);
    expect(undoOps.every((op) => op.type === "delete")).toBe(true);
  });
});
