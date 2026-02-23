import { describe, expect, it } from "bun:test";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { splitListItem } from "prosemirror-schema-list";
import { applyRemoteOps, createCRDTPlugin, type CRDTPluginState } from "@/crdt/prosemirror/plugin";
import type { Operation } from "@/crdt/core/operations";

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
  marks: {},
});

function findTextEndPos(params: { doc: PMNode; text: string }): number {
  let pos: number | null = null;
  params.doc.descendants((node, nodePos) => {
    if (pos !== null) return false;
    if (!node.isText || !node.text) return true;
    const idx = node.text.indexOf(params.text);
    if (idx === -1) return true;
    pos = nodePos + idx + params.text.length;
    return false;
  });
  if (pos === null) throw new Error(`Text not found: ${params.text}`);
  return pos;
}

function createPeers() {
  const opsFromA: Array<Operation> = [];
  const opsFromB: Array<Operation> = [];

  const pluginA = createCRDTPlugin({
    clientId: "A",
    schema: listSchema,
    onLocalOps: (ops) => opsFromA.push(...ops),
  });
  const pluginB = createCRDTPlugin({
    clientId: "B",
    schema: listSchema,
    onLocalOps: (ops) => opsFromB.push(...ops),
  });

  const stateA = EditorState.create({ schema: listSchema, plugins: [pluginA] });
  const stateB = EditorState.create({ schema: listSchema, plugins: [pluginB] });
  return { pluginA, pluginB, stateA, stateB, opsFromA, opsFromB };
}

function bootstrapOrderedList(state: EditorState): EditorState {
  const doc = listSchema.nodes["doc"]!.create(null, [
    listSchema.nodes["ordered_list"]!.create({ order: 1 }, [
      listSchema.nodes["list_item"]!.create(null, [
        listSchema.nodes["paragraph"]!.create(null, [listSchema.text("one")]),
      ]),
      listSchema.nodes["list_item"]!.create(null, [
        listSchema.nodes["paragraph"]!.create(null, [listSchema.text("two")]),
      ]),
    ]),
  ]);
  return state.apply(state.tr.replaceWith(0, state.doc.content.size, doc.content));
}

describe("tx replay harness", () => {
  it("keeps peers converged for ordered-list Enter + concurrent edit replay orderings", () => {
    const base = createPeers();
    let stateA = bootstrapOrderedList(base.stateA);
    let stateB = applyRemoteOps({
      state: base.stateB,
      plugin: base.pluginB,
      ops: base.opsFromA,
    }).state;

    base.opsFromA.length = 0;
    base.opsFromB.length = 0;

    const splitPos = findTextEndPos({ doc: stateA.doc, text: "two" });
    stateA = stateA.apply(stateA.tr.setSelection(TextSelection.create(stateA.doc, splitPos)));
    splitListItem(listSchema.nodes["list_item"]!)(stateA, (tr) => {
      stateA = stateA.apply(tr);
    });

    const bangPos = findTextEndPos({ doc: stateB.doc, text: "one" });
    stateB = stateB.apply(stateB.tr.insertText("!", bangPos, bangPos));

    const txA = [...base.opsFromA];
    const txB = [...base.opsFromB];
    expect(txA.length).toBeGreaterThan(0);
    expect(txB.length).toBeGreaterThan(0);

    const runReplay = (opsOrderForA: Array<ReadonlyArray<Operation>>, opsOrderForB: Array<ReadonlyArray<Operation>>) => {
      const peers = createPeers();
      let a = bootstrapOrderedList(peers.stateA);
      let b = applyRemoteOps({ state: peers.stateB, plugin: peers.pluginB, ops: peers.opsFromA }).state;

      for (const remoteOps of opsOrderForA) {
        a = applyRemoteOps({ state: a, plugin: peers.pluginA, ops: remoteOps }).state;
      }
      for (const remoteOps of opsOrderForB) {
        b = applyRemoteOps({ state: b, plugin: peers.pluginB, ops: remoteOps }).state;
      }
      return { a, b };
    };

    const cases: Array<{ name: string; orderForA: Array<ReadonlyArray<Operation>>; orderForB: Array<ReadonlyArray<Operation>> }> = [
      { name: "opposite-order", orderForA: [txA, txB], orderForB: [txB, txA] },
      { name: "duplicate-A-on-B", orderForA: [txA, txB], orderForB: [txB, txA, txA] },
      { name: "duplicate-B-on-A", orderForA: [txA, txB, txB], orderForB: [txB, txA] },
    ];

    for (const replayCase of cases) {
      const replayed = runReplay(replayCase.orderForA, replayCase.orderForB);
      expect(replayed.a.doc.eq(replayed.b.doc)).toBe(true);
      const orderedA = replayed.a.doc.child(0);
      const orderedB = replayed.b.doc.child(0);
      expect(orderedA.type.name).toBe("ordered_list");
      expect(orderedB.type.name).toBe("ordered_list");
    }
  });
});
