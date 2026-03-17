import { JSDOM } from "jsdom";
import { EditorState, TextSelection, type Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { AllSelection } from "prosemirror-state";
import {
    applyRemoteOps,
    createCRDTPlugin,
    getCRDTState,
    type CRDTPluginState,
    type Operation,
} from "@crdt/lib";
import { tableSchema } from "../../src/components/prosemirror/tables";
import { createNotesEditorState, createNotesEditorView } from "../../src/features/notes/editor-factory";
import { serializeNotesMarkdown } from "../../src/features/notes/editor-markdown";

type PeerId = "A" | "B";
type EquivalenceMode = "strict" | "semantic";

export type SchedulerMode = "immediate" | "queued";

export interface ScenarioStep {
    actor: PeerId;
    key: string;
}

interface TxEnvelope {
    from: PeerId;
    to: PeerId;
    txId: string;
    ops: ReadonlyArray<Operation>;
}

interface PeerRuntime {
    id: PeerId;
    view: EditorView;
    plugin: Plugin<CRDTPluginState>;
    txSequence: number;
}

const KEY_DELAY_MS = 5;

function normalizeMarkdown(markdown: string): string {
    return markdown.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function isPrintableKey(key: string): boolean {
    return key.length === 1;
}

function mapKeyToText(key: string): string | null {
    if (key === "Space") return " ";
    if (key === "Tab") return "\t";
    if (key === "Enter") return "\n";
    return isPrintableKey(key) ? key : null;
}

function getKeyCode(key: string): number {
    switch (key) {
        case "Enter":
            return 13;
        case "Tab":
            return 9;
        case "Backspace":
            return 8;
        case "Delete":
            return 46;
        case "ArrowLeft":
            return 37;
        case "ArrowUp":
            return 38;
        case "ArrowRight":
            return 39;
        case "ArrowDown":
            return 40;
        case "Space":
            return 32;
        default:
            return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
    }
}

function parseKeyCombo(key: string): { key: string; metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean } {
    const parts = key.split("+").map((part) => part.trim());
    const base = parts[parts.length - 1] || key;
    const normalizedMods = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
    return {
        key: base,
        metaKey: normalizedMods.has("mod") || normalizedMods.has("meta") || normalizedMods.has("cmd"),
        ctrlKey: normalizedMods.has("ctrl") || normalizedMods.has("control"),
        shiftKey: normalizedMods.has("shift"),
        altKey: normalizedMods.has("alt") || normalizedMods.has("option"),
    };
}

function coerceSelection(state: EditorState): EditorState {
    const maxPos = state.doc.content.size;
    const { from, to } = state.selection;
    if (from <= maxPos && to <= maxPos) {
        return state;
    }
    const safePos = Math.min(Math.max(1, from), maxPos);
    return EditorState.create({
        doc: state.doc,
        plugins: state.plugins,
        selection: TextSelection.create(state.doc, safePos),
    });
}

export function createTwoPeerHarness(options?: {
    initialMarkdown?: string;
    schedulerMode?: SchedulerMode;
    duplicateDelivery?: boolean;
    dropTxIds?: Set<string>;
}) {
    const schedulerMode = options?.schedulerMode ?? "immediate";
    const duplicateDelivery = options?.duplicateDelivery ?? false;
    const dropTxIds = options?.dropTxIds ?? new Set<string>();
    const logs: string[] = [];
    const queue: TxEnvelope[] = [];
    const deliveredByPeer = new Map<PeerId, Set<string>>([
        ["A", new Set<string>()],
        ["B", new Set<string>()],
    ]);

    const originalGlobals = {
        window: (globalThis as any).window,
        document: (globalThis as any).document,
        navigator: (globalThis as any).navigator,
        HTMLElement: (globalThis as any).HTMLElement,
        Node: (globalThis as any).Node,
        getSelection: (globalThis as any).getSelection,
        requestAnimationFrame: (globalThis as any).requestAnimationFrame,
        cancelAnimationFrame: (globalThis as any).cancelAnimationFrame,
        getComputedStyle: (globalThis as any).getComputedStyle,
    };

    const dom = new JSDOM("<!doctype html><html><body><div id='peer-a'></div><div id='peer-b'></div></body></html>");
    const win = dom.window as unknown as Window & typeof globalThis;
    (globalThis as any).window = win;
    (globalThis as any).document = win.document;
    (globalThis as any).navigator = win.navigator;
    (globalThis as any).HTMLElement = win.HTMLElement;
    (globalThis as any).Node = win.Node;
    (globalThis as any).getSelection = win.getSelection.bind(win);
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
    (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    (globalThis as any).getComputedStyle = win.getComputedStyle.bind(win);

    const refs = new Map<PeerId, PeerRuntime>();

    const deliver = (tx: TxEnvelope) => {
        if (dropTxIds.has(tx.txId)) {
            logs.push(`drop tx ${tx.txId} ${tx.from}->${tx.to}`);
            return;
        }

        const target = refs.get(tx.to);
        if (!target) throw new Error(`Missing target peer ${tx.to}`);
        const deliveredSet = deliveredByPeer.get(tx.to)!;
        const isDuplicate = deliveredSet.has(tx.txId);
        deliveredSet.add(tx.txId);

        const safeState = coerceSelection(target.view.state);
        if (safeState !== target.view.state) {
            target.view.updateState(safeState);
        }
        const before = normalizeMarkdown(serializeNotesMarkdown(target.view.state.doc));
        const result = applyRemoteOps({
            state: target.view.state,
            plugin: target.plugin,
            ops: tx.ops,
        });
        target.view.updateState(result.state);
        const after = normalizeMarkdown(serializeNotesMarkdown(target.view.state.doc));
        logs.push(`deliver tx=${tx.txId} ${tx.from}->${tx.to} ops=${tx.ops.length} duplicate=${String(isDuplicate)} before="${before}" after="${after}"`);
    };

    const enqueueTx = (tx: TxEnvelope) => {
        logs.push(`enqueue tx=${tx.txId} ${tx.from}->${tx.to} ops=${tx.ops.length}`);
        if (schedulerMode === "immediate") {
            deliver(tx);
            if (duplicateDelivery) {
                deliver({ ...tx });
            }
            return;
        }
        queue.push(tx);
        if (duplicateDelivery) {
            queue.push({ ...tx });
        }
    };

    const createPeer = (id: PeerId, mountId: string) => {
        let peer!: PeerRuntime;
        const plugin = createCRDTPlugin({
            clientId: id.toLowerCase(),
            schema: tableSchema,
            onLocalOps: (ops) => {
                if (ops.length === 0) return;
                peer.txSequence += 1;
                const txId = `${id}:${peer.txSequence}`;
                const target = id === "A" ? "B" : "A";
                enqueueTx({ from: id, to: target, txId, ops });
                const summary = ops.map((op) => {
                    if (op.type === "insert") {
                        if (op.content.type === "block") return `insert:block:${op.content.blockType}`;
                        if (op.content.type === "text") return `insert:text:${op.content.value}`;
                        return `insert:${op.content.type}`;
                    }
                    return op.type;
                }).join(",");
                logs.push(`local tx=${txId} actor=${id} ops=${ops.length} [${summary}]`);
            },
        });
        const state = createNotesEditorState({
            markdown: options?.initialMarkdown ?? "",
            isCollabMode: true,
            collabPlugins: [plugin],
            onWikiLinkStateChange: () => undefined,
            onTagLinkStateChange: () => undefined,
            includeSearchPlugin: true,
            includeSpellcheckPlugin: false,
            includeMenuBar: false,
        });
        const mount = win.document.getElementById(mountId);
        if (!mount) throw new Error(`Missing mount ${mountId}`);
        const view = createNotesEditorView({
            mount,
            state,
            props: {
                dispatchTransaction: (tr) => {
                    const stepKinds = tr.steps.map((step) => {
                        const asAny = step as { toJSON?: () => unknown; constructor?: { name?: string } };
                        try {
                            const json = asAny.toJSON?.() as { stepType?: string } | undefined;
                            return `${json?.stepType ?? asAny.constructor?.name ?? "unknown"}:${JSON.stringify(json ?? {})}`;
                        } catch {
                            return asAny.constructor?.name ?? "unknown";
                        }
                    });
                    if (stepKinds.length > 0) {
                        logs.push(`pm_steps actor=${id} kinds=${stepKinds.join(",")} sel=${tr.selection.from}-${tr.selection.to}`);
                    }
                    const next = view.state.apply(tr);
                    view.updateState(next);
                },
            },
        });
        peer = { id, view, plugin, txSequence: 0 };
        refs.set(id, peer);
    };

    createPeer("A", "peer-a");
    createPeer("B", "peer-b");

    const getPeer = (peerId: PeerId) => {
        const peer = refs.get(peerId);
        if (!peer) throw new Error(`Unknown peer ${peerId}`);
        return peer;
    };

    const fireKeydown = (view: EditorView, combo: ReturnType<typeof parseKeyCombo>) => {
        const keyCode = getKeyCode(combo.key);
        let defaultPrevented = false;
        const event = {
            key: combo.key,
            code: combo.key,
            keyCode,
            which: keyCode,
            metaKey: combo.metaKey,
            shiftKey: combo.shiftKey,
            ctrlKey: combo.ctrlKey,
            altKey: combo.altKey,
            preventDefault() {
                defaultPrevented = true;
            },
            get defaultPrevented() {
                return defaultPrevented;
            },
        } as unknown as KeyboardEvent;
        return view.someProp("handleKeyDown", (handler) => handler(view, event)) || false;
    };

    const fireTextInput = (view: EditorView, text: string) => {
        const { from, to } = view.state.selection;
        return view.someProp(
            "handleTextInput",
            (handler) => handler(view, from, to, text, () => view.state.tr.insertText(text, from, to))
        ) || false;
    };

    const pressKey = async (peerId: PeerId, key: string) => {
        const peer = getPeer(peerId);
        const combo = parseKeyCombo(key);
        peer.view.focus();
        if (combo.key === "__SET_START__") {
            peer.view.dispatch(peer.view.state.tr.setSelection(TextSelection.create(peer.view.state.doc, 1)));
            logs.push(`set-selection-start actor=${peerId}`);
            await new Promise((resolve) => setTimeout(resolve, KEY_DELAY_MS));
            return;
        }
        const handled = fireKeydown(peer.view, combo);
        const lowerKey = combo.key.toLowerCase();
        if (!handled) {
            if ((combo.metaKey || combo.ctrlKey) && lowerKey === "a") {
                const allSelection = new AllSelection(peer.view.state.doc);
                peer.view.dispatch(peer.view.state.tr.setSelection(allSelection));
                logs.push(`select-all actor=${peerId}`);
                await new Promise((resolve) => setTimeout(resolve, KEY_DELAY_MS));
                return;
            }
            const text = mapKeyToText(combo.key);
            if (text !== null) {
                const handledTextInput = fireTextInput(peer.view, text);
                if (!handledTextInput) {
                    const { from, to } = peer.view.state.selection;
                    peer.view.dispatch(peer.view.state.tr.insertText(text, from, to));
                }
            } else if (combo.key === "Backspace") {
                const { from, to, empty } = peer.view.state.selection;
                if (empty && from > 1) {
                    peer.view.dispatch(peer.view.state.tr.delete(from - 1, from));
                } else if (!empty) {
                    peer.view.dispatch(peer.view.state.tr.delete(from, to));
                }
            } else if (combo.key === "Delete") {
                const { from, to, empty } = peer.view.state.selection;
                if (empty) {
                    peer.view.dispatch(peer.view.state.tr.delete(from, Math.min(from + 1, peer.view.state.doc.content.size)));
                } else {
                    peer.view.dispatch(peer.view.state.tr.delete(from, to));
                }
            }
        }
        logs.push(`key actor=${peerId} key=${key}`);
        await new Promise((resolve) => setTimeout(resolve, KEY_DELAY_MS));
    };

    const runSteps = async (steps: ScenarioStep[]) => {
        for (const step of steps) {
            await pressKey(step.actor, step.key);
        }
    };

    const flushAll = () => {
        while (queue.length > 0) {
            const next = queue.shift();
            if (next) deliver(next);
        }
    };

    const flushPeer = (peerId: PeerId) => {
        let index = 0;
        while (index < queue.length) {
            const tx = queue[index];
            if (!tx || tx.to !== peerId) {
                index += 1;
                continue;
            }
            queue.splice(index, 1);
            deliver(tx);
        }
    };

    const flushInOrder = (txIds: string[]) => {
        for (const txId of txIds) {
            const index = queue.findIndex((entry) => entry.txId === txId);
            if (index === -1) {
                throw new Error(`Missing queued tx ${txId}`);
            }
            const [tx] = queue.splice(index, 1);
            if (tx) deliver(tx);
        }
    };

    const getPeerSnapshot = (peerId: PeerId) => {
        const peer = getPeer(peerId);
        const pluginDoc = getCRDTState({ state: peer.view.state, plugin: peer.plugin }).doc as {
            stateVector: ReadonlyMap<string, number>;
        };
        return {
            markdown: serializeNotesMarkdown(peer.view.state.doc),
            normalizedMarkdown: normalizeMarkdown(serializeNotesMarkdown(peer.view.state.doc)),
            textContent: peer.view.state.doc.textContent,
            docJson: peer.view.state.doc.toJSON(),
            domHtml: peer.view.dom.innerHTML,
            stateVector: Array.from(pluginDoc.stateVector.entries()),
        };
    };

    const assertPeersEquivalent = (mode: EquivalenceMode = "strict") => {
        const a = getPeerSnapshot("A");
        const b = getPeerSnapshot("B");
        if (a.normalizedMarkdown !== b.normalizedMarkdown) {
            throw new Error(
                `markdown mismatch\nA:\n${a.markdown}\n\nB:\n${b.markdown}\n\nlogs:\n${logs.join("\n")}`
            );
        }
        if (mode === "strict") {
            const aJson = JSON.stringify(a.docJson);
            const bJson = JSON.stringify(b.docJson);
            if (aJson !== bJson) {
                throw new Error(`doc json mismatch\nA=${aJson}\nB=${bJson}\nlogs:\n${logs.join("\n")}`);
            }
        }
    };

    const destroy = () => {
        const a = refs.get("A");
        const b = refs.get("B");
        a?.view.destroy();
        b?.view.destroy();
        dom.window.close();
        (globalThis as any).window = originalGlobals.window;
        (globalThis as any).document = originalGlobals.document;
        (globalThis as any).navigator = originalGlobals.navigator;
        (globalThis as any).HTMLElement = originalGlobals.HTMLElement;
        (globalThis as any).Node = originalGlobals.Node;
        (globalThis as any).getSelection = originalGlobals.getSelection;
        (globalThis as any).requestAnimationFrame = originalGlobals.requestAnimationFrame;
        (globalThis as any).cancelAnimationFrame = originalGlobals.cancelAnimationFrame;
        (globalThis as any).getComputedStyle = originalGlobals.getComputedStyle;
    };

    return {
        pressKey,
        runSteps,
        flushAll,
        flushPeer,
        flushInOrder,
        getPeerSnapshot,
        assertPeersEquivalent,
        getLogs: () => [...logs],
        getQueuedTxIds: () => queue.map((tx) => tx.txId),
        destroy,
    };
}
