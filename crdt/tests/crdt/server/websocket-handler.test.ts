import { describe, test, expect } from "bun:test";
import { createCRDTWebSocketHandler, type WSClient } from "@/crdt/server/websocket-handler";
import { createOperationId } from "@/crdt/core/operations";
import type { FieldOp, RecordOp } from "@/crdt/document/record";
import { encodeStateVector, createStateVector, updateStateVector } from "@/crdt/network/state-vector";
import { decodeRecordSnapshot } from "@/crdt/document/snapshot";
import { getField } from "@/crdt/document/record";

/** Create a mock WSClient that records sent messages */
function createMockClient(id: string): WSClient & { messages: string[] } {
  const messages: string[] = [];
  return {
    id,
    messages,
    send(message: string) {
      messages.push(message);
    },
  };
}

function makeFieldOp(params: {
  clientId: string;
  clock: number;
  fieldName: string;
  value: string;
}): FieldOp {
  return {
    type: "field",
    id: createOperationId({ clientId: params.clientId, clock: params.clock }),
    fieldName: params.fieldName,
    value: params.value,
    timestamp: { clientId: params.clientId, clock: params.clock },
  };
}

describe("createCRDTWebSocketHandler (unified protocol)", () => {
  test("creates handler with default state", () => {
    const handler = createCRDTWebSocketHandler();
    const state = handler.getDocManagerState();
    expect(state.manager).toBeDefined();
    expect(state.clock).toBeDefined();
  });

  test("creates handler with custom serverClientId", () => {
    const handler = createCRDTWebSocketHandler({ serverClientId: "my-server" });
    const state = handler.getDocManagerState();
    expect(state.clock.clientId).toBe("my-server");
  });

  test("handleOpen does NOT send ops (client must subscribe)", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("client-1");

    handler.handleOpen({ client });

    expect(client.messages.length).toBe(0);
  });

  test("subscribe without stateVector sends all ops as sync-response", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("client-1");
    handler.handleOpen({ client });

    // Pre-populate ops for a doc
    const op = makeFieldOp({ clientId: "server", clock: 1, fieldName: "title", value: "Test" });
    handler.appendDocOps({ docId: "doc-1", ops: [op] });

    // Apply to doc manager so stateVector is tracked
    const state = handler.getDocManagerState();
    const { applyDocOperation } = require("@/crdt/document/doc-manager");
    const newManager = applyDocOperation({ manager: state.manager, docId: "doc-1", op });
    handler.setDocManagerState({ state: { ...state, manager: newManager } });

    // Subscribe without stateVector
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "subscribe", docId: "doc-1" }),
    });

    expect(client.messages.length).toBe(1);
    const msg = JSON.parse(client.messages[0]!) as { type: string; docId: string; ops: ReadonlyArray<RecordOp> };
    expect(msg.type).toBe("sync-response");
    expect(msg.docId).toBe("doc-1");
    expect(msg.ops.length).toBe(1);
  });

  test("subscribe with stateVector sends only delta ops as sync-response", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("client-1");
    handler.handleOpen({ client });

    // Pre-populate 3 ops
    const op1 = makeFieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "v1" });
    const op2 = makeFieldOp({ clientId: "A", clock: 2, fieldName: "title", value: "v2" });
    const op3 = makeFieldOp({ clientId: "B", clock: 1, fieldName: "desc", value: "d1" });
    handler.appendDocOps({ docId: "doc-1", ops: [op1, op2, op3] });

    // Apply to doc manager
    const state = handler.getDocManagerState();
    const { applyDocOperation } = require("@/crdt/document/doc-manager");
    let manager = state.manager;
    for (const op of [op1, op2, op3]) {
      manager = applyDocOperation({ manager, docId: "doc-1", op });
    }
    handler.setDocManagerState({ state: { ...state, manager } });

    // Client already has A:1 — should only get A:2 and B:1
    let sv = createStateVector();
    sv = updateStateVector({ sv, clientId: "A", clock: 1 });
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "subscribe", docId: "doc-1", stateVector: encodeStateVector({ sv }) }),
    });

    expect(client.messages.length).toBe(1);
    const msg = JSON.parse(client.messages[0]!) as { type: string; docId: string; ops: ReadonlyArray<RecordOp> };
    expect(msg.type).toBe("sync-response");
    expect(msg.ops.length).toBe(2);
  });

  test("subscribe to empty doc sends empty sync-response", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("client-1");
    handler.handleOpen({ client });

    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "subscribe", docId: "nonexistent" }),
    });

    expect(client.messages.length).toBe(1);
    const msg = JSON.parse(client.messages[0]!) as { type: string; docId: string; ops: ReadonlyArray<RecordOp> };
    expect(msg.type).toBe("sync-response");
    expect(msg.ops.length).toBe(0);
  });

  test("ops are applied to DocManager and broadcast to subscribers", () => {
    const handler = createCRDTWebSocketHandler();
    const client1 = createMockClient("c1");
    const client2 = createMockClient("c2");
    handler.handleOpen({ client: client1 });
    handler.handleOpen({ client: client2 });

    // Both subscribe to doc-1
    handler.handleMessage({ client: client1, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    handler.handleMessage({ client: client2, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    client1.messages.length = 0;
    client2.messages.length = 0;

    // Client1 sends ops
    const op = makeFieldOp({ clientId: "c1", clock: 1, fieldName: "title", value: "Hello" });
    handler.handleMessage({
      client: client1,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op] }),
    });

    // Client2 should get the broadcast
    expect(client2.messages.length).toBe(1);
    const msg = JSON.parse(client2.messages[0]!) as { type: string; docId: string };
    expect(msg.type).toBe("ops");
    expect(msg.docId).toBe("doc-1");

    // Client1 should NOT get its own broadcast
    expect(client1.messages.length).toBe(0);

    // Ops stored
    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(1);
  });

  test("ops are NOT sent to unsubscribed clients", () => {
    const handler = createCRDTWebSocketHandler();
    const subscriber = createMockClient("sub");
    const nonSubscriber = createMockClient("nonsub");
    handler.handleOpen({ client: subscriber });
    handler.handleOpen({ client: nonSubscriber });

    handler.handleMessage({ client: subscriber, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    subscriber.messages.length = 0;

    // Broadcast via external call
    const op = makeFieldOp({ clientId: "server", clock: 1, fieldName: "x", value: "y" });
    handler.broadcastDocOps({ docId: "doc-1", ops: [op] });

    expect(subscriber.messages.length).toBe(1);
    expect(nonSubscriber.messages.length).toBe(0);
  });

  test("unsubscribe stops receiving ops", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("c1");
    handler.handleOpen({ client });

    handler.handleMessage({ client, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    client.messages.length = 0;

    handler.handleMessage({ client, message: JSON.stringify({ type: "unsubscribe", docId: "doc-1" }) });

    const op = makeFieldOp({ clientId: "x", clock: 1, fieldName: "a", value: "b" });
    handler.broadcastDocOps({ docId: "doc-1", ops: [op] });

    expect(client.messages.length).toBe(0);
  });

  test("handleClose removes client", () => {
    const handler = createCRDTWebSocketHandler();
    const client1 = createMockClient("c1");
    const client2 = createMockClient("c2");
    handler.handleOpen({ client: client1 });
    handler.handleOpen({ client: client2 });

    // Subscribe both
    handler.handleMessage({ client: client1, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    handler.handleMessage({ client: client2, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });

    // Disconnect client2
    handler.handleClose({ client: client2 });
    client1.messages.length = 0;
    client2.messages.length = 0;

    // Broadcast — only client1 should get it
    const op = makeFieldOp({ clientId: "x", clock: 1, fieldName: "a", value: "b" });
    handler.broadcastDocOps({ docId: "doc-1", ops: [op] });

    expect(client1.messages.length).toBe(1);
    expect(client2.messages.length).toBe(0);
  });

  test("awareness messages are relayed to doc subscribers", () => {
    const handler = createCRDTWebSocketHandler();
    const client1 = createMockClient("c1");
    const client2 = createMockClient("c2");
    const client3 = createMockClient("c3");
    handler.handleOpen({ client: client1 });
    handler.handleOpen({ client: client2 });
    handler.handleOpen({ client: client3 });

    // c1 and c2 subscribe to doc-1; c3 does not
    handler.handleMessage({ client: client1, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    handler.handleMessage({ client: client2, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    client1.messages.length = 0;
    client2.messages.length = 0;
    client3.messages.length = 0;

    // c1 sends awareness
    const awarenessMsg = JSON.stringify({
      type: "awareness",
      docId: "doc-1",
      clientId: "c1",
      state: { cursor: { anchor: 5, head: 5 }, user: { name: "c1", color: "#ff0000" }, lastUpdated: Date.now() },
    });
    handler.handleMessage({ client: client1, message: awarenessMsg });

    // c2 should get it (subscribed, not sender)
    expect(client2.messages.length).toBe(1);
    const msg = JSON.parse(client2.messages[0]!) as { type: string; docId: string; clientId: string };
    expect(msg.type).toBe("awareness");
    expect(msg.docId).toBe("doc-1");
    expect(msg.clientId).toBe("c1");

    // c1 should NOT get its own
    expect(client1.messages.length).toBe(0);
    // c3 should NOT get it (not subscribed)
    expect(client3.messages.length).toBe(0);
  });

  test("getDocManagerState and setDocManagerState work", () => {
    const handler = createCRDTWebSocketHandler();
    const state = handler.getDocManagerState();
    expect(state.manager).toBeDefined();
    expect(state.clock).toBeDefined();

    const { createDocManager } = require("@/crdt/document/doc-manager");
    const { createClock } = require("@/crdt/core/lamport-clock");
    const newState = {
      manager: createDocManager(),
      clock: createClock({ clientId: "new-server" }),
    };
    handler.setDocManagerState({ state: newState });

    const updated = handler.getDocManagerState();
    expect(updated.clock.clientId).toBe("new-server");
  });

  test("appendDocOps and getDocOps work", () => {
    const handler = createCRDTWebSocketHandler();
    const op = makeFieldOp({ clientId: "server", clock: 1, fieldName: "title", value: "Test" });

    handler.appendDocOps({ docId: "doc-1", ops: [op] });

    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(1);
    expect(handler.getDocOps({ docId: "nonexistent" }).length).toBe(0);
  });

  test("server clock is synced from incoming ops", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("c1");
    handler.handleOpen({ client });
    handler.handleMessage({ client, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    client.messages.length = 0;

    const op = makeFieldOp({ clientId: "c1", clock: 42, fieldName: "title", value: "Hi" });
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op] }),
    });

    // Server clock should have received clock 42
    const state = handler.getDocManagerState();
    expect(state.clock.counter).toBeGreaterThanOrEqual(42);
  });

  test("messages without docId are ignored", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("c1");
    handler.handleOpen({ client });

    // Legacy message without docId
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", ops: [{ id: { clientId: "x", clock: 1 } }] }),
    });

    // Should not crash, no ops stored
    expect(handler.getDocOps({ docId: "undefined" }).length).toBe(0);
  });

  test("onDocChanged fires when client sends ops", () => {
    const changes: Array<{ docId: string; ops: ReadonlyArray<RecordOp>; source: string }> = [];
    const handler = createCRDTWebSocketHandler({
      onDocChanged({ docId, ops, source }) {
        changes.push({ docId, ops, source });
      },
    });
    const client = createMockClient("c1");
    handler.handleOpen({ client });
    handler.handleMessage({ client, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    client.messages.length = 0;

    const op = makeFieldOp({ clientId: "c1", clock: 1, fieldName: "title", value: "Hello" });
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op] }),
    });

    expect(changes.length).toBe(1);
    expect(changes[0]!.docId).toBe("doc-1");
    expect(changes[0]!.source).toBe("client");
    expect(changes[0]!.ops.length).toBe(1);
  });

  test("onDocChanged fires when appendDocOps is called", () => {
    const changes: Array<{ docId: string; ops: ReadonlyArray<RecordOp>; source: string }> = [];
    const handler = createCRDTWebSocketHandler({
      onDocChanged({ docId, ops, source }) {
        changes.push({ docId, ops, source });
      },
    });

    const op = makeFieldOp({ clientId: "server", clock: 1, fieldName: "title", value: "Test" });
    handler.appendDocOps({ docId: "doc-1", ops: [op] });

    expect(changes.length).toBe(1);
    expect(changes[0]!.docId).toBe("doc-1");
    expect(changes[0]!.source).toBe("server");
  });

  test("onDocChanged is optional (no crash when omitted)", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("c1");
    handler.handleOpen({ client });
    handler.handleMessage({ client, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });
    client.messages.length = 0;

    const op = makeFieldOp({ clientId: "c1", clock: 1, fieldName: "title", value: "Hello" });
    // Should not throw even without onDocChanged
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op] }),
    });

    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(1);
  });

  test("checkpointDoc creates a snapshot and clears ops", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("c1");
    handler.handleOpen({ client });
    handler.handleMessage({ client, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });

    // Send some ops
    const op1 = makeFieldOp({ clientId: "c1", clock: 1, fieldName: "title", value: "Hello" });
    const op2 = makeFieldOp({ clientId: "c1", clock: 2, fieldName: "description", value: "World" });
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op1, op2] }),
    });

    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(2);
    expect(handler.hasCheckpoint({ docId: "doc-1" })).toBe(false);

    // Checkpoint
    handler.checkpointDoc({ docId: "doc-1" });

    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(0);
    expect(handler.hasCheckpoint({ docId: "doc-1" })).toBe(true);

    // DocManager state should still have the data
    const { getDoc } = require("@/crdt/document/doc-manager");
    const record = getDoc({ manager: handler.getDocManagerState().manager, docId: "doc-1" });
    expect(getField({ record, fieldName: "title" })).toBe("Hello");
    expect(getField({ record, fieldName: "description" })).toBe("World");
  });

  test("subscribe after checkpoint sends snapshot in sync-response", () => {
    const handler = createCRDTWebSocketHandler();

    // Apply ops and checkpoint
    const client1 = createMockClient("c1");
    handler.handleOpen({ client: client1 });
    handler.handleMessage({ client: client1, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });

    const op = makeFieldOp({ clientId: "c1", clock: 1, fieldName: "title", value: "Checkpointed" });
    handler.handleMessage({
      client: client1,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op] }),
    });
    handler.checkpointDoc({ docId: "doc-1" });

    // Add a post-checkpoint op
    const postOp = makeFieldOp({ clientId: "c1", clock: 2, fieldName: "title", value: "Updated" });
    handler.handleMessage({
      client: client1,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [postOp] }),
    });

    // New client subscribes
    const client2 = createMockClient("c2");
    handler.handleOpen({ client: client2 });
    handler.handleMessage({
      client: client2,
      message: JSON.stringify({ type: "subscribe", docId: "doc-1" }),
    });

    // Should get sync-response with 1 message (skip the auto sync-response on first subscribe)
    // The first message for c2 should be the sync-response
    expect(client2.messages.length).toBe(1);
    const syncMsg = JSON.parse(client2.messages[0]!) as {
      type: string;
      docId: string;
      snapshot?: string;
      ops: ReadonlyArray<RecordOp>;
    };
    expect(syncMsg.type).toBe("sync-response");
    expect(syncMsg.docId).toBe("doc-1");
    expect(syncMsg.snapshot).toBeDefined();
    expect(syncMsg.ops.length).toBe(1); // Only the post-checkpoint op

    // Decode the snapshot and verify
    const binaryStr = atob(syncMsg.snapshot!);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const restored = decodeRecordSnapshot({ data: bytes });
    expect(getField({ record: restored, fieldName: "title" })).toBe("Checkpointed");
  });

  test("checkpointDoc on non-existent doc does nothing", () => {
    const handler = createCRDTWebSocketHandler();
    handler.checkpointDoc({ docId: "nonexistent" });
    expect(handler.hasCheckpoint({ docId: "nonexistent" })).toBe(false);
  });

  test("ops after checkpoint are tracked normally", () => {
    const handler = createCRDTWebSocketHandler();
    const client = createMockClient("c1");
    handler.handleOpen({ client });
    handler.handleMessage({ client, message: JSON.stringify({ type: "subscribe", docId: "doc-1" }) });

    const op1 = makeFieldOp({ clientId: "c1", clock: 1, fieldName: "title", value: "Before" });
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op1] }),
    });

    handler.checkpointDoc({ docId: "doc-1" });
    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(0);

    const op2 = makeFieldOp({ clientId: "c1", clock: 2, fieldName: "title", value: "After" });
    handler.handleMessage({
      client,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op2] }),
    });

    expect(handler.getDocOps({ docId: "doc-1" }).length).toBe(1);
  });
});
