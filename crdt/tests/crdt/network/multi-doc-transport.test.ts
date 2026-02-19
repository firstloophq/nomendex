import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createMultiDocTransport, type MultiDocTransport } from "@/crdt/network/multi-doc-transport";
import type { RecordOp } from "@/crdt/document/record";
import { createOperationId } from "@/crdt/core/operations";
import { createStateVector, updateStateVector, encodeStateVector } from "@/crdt/network/state-vector";

// --- Mock WebSocket ---

interface MockWS {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  readyState: number;
  sentMessages: string[];
  close(): void;
  send(msg: string): void;
  _simulateOpen(): void;
  _simulateMessage(data: string): void;
  _simulateClose(): void;
}

let mockWSInstances: MockWS[] = [];

function createMockWSClass() {
  return class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static CONNECTING = 0;

    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readyState = 0;
    sentMessages: string[] = [];
    url: string;

    constructor(url: string) {
      this.url = url;
      mockWSInstances.push(this as unknown as MockWS);
    }

    send(msg: string) {
      this.sentMessages.push(msg);
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }

    _simulateOpen() {
      this.readyState = 1;
      this.onopen?.();
    }

    _simulateMessage(data: string) {
      this.onmessage?.({ data });
    }

    _simulateClose() {
      this.readyState = 3;
      this.onclose?.();
    }
  };
}

function makeFieldOp(clientId: string, clock: number): RecordOp {
  return {
    type: "field" as const,
    id: createOperationId({ clientId, clock }),
    fieldName: "title",
    value: `v${clock}`,
    timestamp: { clientId, clock },
  };
}

describe("MultiDocTransport (unified)", () => {
  let OriginalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    mockWSInstances = [];
    OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = createMockWSClass() as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  function getLatestWS(): MockWS {
    return mockWSInstances[mockWSInstances.length - 1]!;
  }

  test("connects with clientId in URL", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test-client",
      onOps: () => {},
    });

    expect(mockWSInstances.length).toBe(1);
    expect((getLatestWS() as unknown as { url: string }).url).toContain("clientId=test-client");
    transport.close();
  });

  test("calls onConnect when WS opens", () => {
    let connected = false;
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
      onConnect: () => { connected = true; },
    });

    getLatestWS()._simulateOpen();
    expect(connected).toBe(true);
    transport.close();
  });

  test("subscribe sends subscribe message with docId", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });

    const msgs = getLatestWS().sentMessages;
    const subscribeMsg = msgs.find(m => {
      const p = JSON.parse(m) as { type: string; docId: string };
      return p.type === "subscribe" && p.docId === "doc-1";
    });
    expect(subscribeMsg).toBeDefined();
    transport.close();
  });

  test("subscribe with initialStateVector sends stateVector", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    let sv = createStateVector();
    sv = updateStateVector({ sv, clientId: "A", clock: 5 });
    transport.subscribe({ docId: "doc-1", initialStateVector: sv });

    const msgs = getLatestWS().sentMessages;
    const subscribeMsg = msgs.find(m => {
      const p = JSON.parse(m) as { type: string; stateVector?: string };
      return p.type === "subscribe" && p.stateVector !== undefined;
    });
    expect(subscribeMsg).toBeDefined();
    const parsed = JSON.parse(subscribeMsg!) as { stateVector: string };
    expect(parsed.stateVector).toContain("A");
    transport.close();
  });

  test("isSyncing returns true after subscribe, false after sync-response", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });

    expect(transport.isSyncing({ docId: "doc-1" })).toBe(true);

    // Simulate sync-response
    getLatestWS()._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [],
    }));

    expect(transport.isSyncing({ docId: "doc-1" })).toBe(false);
    transport.close();
  });

  test("onDocSyncComplete fires after sync-response", () => {
    let syncedDocId = "";
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
      onDocSyncComplete: ({ docId }) => { syncedDocId = docId; },
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });

    getLatestWS()._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [],
    }));

    expect(syncedDocId).toBe("doc-1");
    transport.close();
  });

  test("ops received during sync are buffered then delivered", () => {
    const receivedOps: RecordOp[] = [];
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: ({ ops }) => { receivedOps.push(...ops); },
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });

    // Ops arrive during sync phase
    const bufferedOp = makeFieldOp("X", 99);
    getLatestWS()._simulateMessage(JSON.stringify({
      type: "ops",
      docId: "doc-1",
      ops: [bufferedOp],
    }));

    // Not yet delivered (still syncing)
    expect(receivedOps.length).toBe(0);

    // Sync-response arrives
    const syncOp = makeFieldOp("Y", 1);
    getLatestWS()._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [syncOp],
    }));

    // Both sync ops and buffered ops delivered
    expect(receivedOps.length).toBe(2);
    transport.close();
  });

  test("send queues ops offline", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    // Not connected yet — ops should be queued
    const op = makeFieldOp("A", 1);
    transport.send({ docId: "doc-1", ops: [op] });

    expect(transport.pendingOpsCount()).toBe(1);
    transport.close();
  });

  test("send transmits ops when connected and not syncing", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    // No subscription, so no sync state for doc-1
    const op = makeFieldOp("A", 1);
    transport.send({ docId: "doc-1", ops: [op] });

    const sentOpsMsg = getLatestWS().sentMessages.find(m => {
      const p = JSON.parse(m) as { type: string; docId: string };
      return p.type === "ops" && p.docId === "doc-1";
    });
    expect(sentOpsMsg).toBeDefined();
    expect(transport.pendingOpsCount()).toBe(0);
    transport.close();
  });

  test("sendAwareness sends when connected, drops when offline", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    // Offline — awareness not queued
    transport.sendAwareness({
      docId: "doc-1",
      clientId: "test",
      state: { cursor: { anchor: 0, head: 0 }, user: { name: "t", color: "#000" }, lastUpdated: 0 },
    });
    expect(getLatestWS().sentMessages.length).toBe(0);

    // Online
    getLatestWS()._simulateOpen();
    transport.sendAwareness({
      docId: "doc-1",
      clientId: "test",
      state: { cursor: { anchor: 5, head: 5 }, user: { name: "t", color: "#000" }, lastUpdated: 0 },
    });

    const awarenessMsg = getLatestWS().sentMessages.find(m => {
      const p = JSON.parse(m) as { type: string };
      return p.type === "awareness";
    });
    expect(awarenessMsg).toBeDefined();
    transport.close();
  });

  test("onAwareness callback receives awareness messages", () => {
    let received: { docId: string; clientId: string } | null = null;
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
      onAwareness: (params) => { received = { docId: params.docId, clientId: params.clientId }; },
    });

    getLatestWS()._simulateOpen();
    getLatestWS()._simulateMessage(JSON.stringify({
      type: "awareness",
      docId: "doc-1",
      clientId: "remote-user",
      state: { cursor: { anchor: 3, head: 3 }, user: { name: "r", color: "#f00" }, lastUpdated: 0 },
    }));

    const got = received as { docId: string; clientId: string } | null;
    if (!got) throw new Error("Expected awareness callback to run");
    expect(got.docId).toBe("doc-1");
    expect(got.clientId).toBe("remote-user");
    transport.close();
  });

  test("disconnect stops reconnection", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    transport.disconnect();

    expect(transport.isConnected()).toBe(false);
    // Should not create a new WS instance after disconnect
    const countAfterDisconnect = mockWSInstances.length;
    // Wait a bit to make sure no reconnect fires
    expect(mockWSInstances.length).toBe(countAfterDisconnect);
    transport.close();
  });

  test("reconnect creates new connection", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    transport.disconnect();

    const countBefore = mockWSInstances.length;
    transport.reconnect();
    expect(mockWSInstances.length).toBe(countBefore + 1);
    transport.close();
  });

  test("reconnect re-subscribes with stateVectors for delta sync", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    const ws1 = getLatestWS();
    ws1._simulateOpen();

    // Subscribe and complete sync
    transport.subscribe({ docId: "doc-1" });
    ws1._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [makeFieldOp("A", 1)],
    }));

    // Disconnect and reconnect
    transport.disconnect();
    transport.reconnect();

    const ws2 = getLatestWS();
    ws2._simulateOpen();

    // Should re-subscribe with stateVector
    const resubscribeMsg = ws2.sentMessages.find(m => {
      const p = JSON.parse(m) as { type: string; docId: string; stateVector?: string };
      return p.type === "subscribe" && p.docId === "doc-1" && p.stateVector !== undefined;
    });
    expect(resubscribeMsg).toBeDefined();
    transport.close();
  });

  test("close clears all state and pending ops", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    transport.send({ docId: "doc-1", ops: [makeFieldOp("A", 1)] });
    expect(transport.pendingOpsCount()).toBe(1);

    transport.close();
    expect(transport.pendingOpsCount()).toBe(0);
    expect(transport.isConnected()).toBe(false);
  });

  test("getAuthToken is called on connect and token appended to URL", async () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
      getAuthToken: () => "my-secret-token",
    });

    // Wait for async connect
    await new Promise(resolve => setTimeout(resolve, 10));

    const ws = getLatestWS();
    expect((ws as unknown as { url: string }).url).toContain("token=my-secret-token");
    transport.close();
  });

  test("unsubscribe clears sync state for that doc", () => {
    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });
    expect(transport.isSyncing({ docId: "doc-1" })).toBe(true);

    transport.unsubscribe({ docId: "doc-1" });
    expect(transport.isSyncing({ docId: "doc-1" })).toBe(false);
    transport.close();
  });

  test("sync-response with snapshot calls onSnapshot before onOps", () => {
    const callOrder: string[] = [];
    let snapshotData: Uint8Array | null = null;
    const receivedOps: RecordOp[] = [];

    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps({ ops }) {
        callOrder.push("onOps");
        receivedOps.push(...ops);
      },
      onSnapshot({ data }) {
        callOrder.push("onSnapshot");
        snapshotData = data;
      },
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });

    // Simulate a sync-response with snapshot
    const fakePayload = JSON.stringify({ test: true });
    const base64Snapshot = btoa(fakePayload);
    const postOp = makeFieldOp("A", 2);

    getLatestWS()._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      snapshot: base64Snapshot,
      ops: [postOp],
    }));

    // onSnapshot should fire before onOps
    expect(callOrder).toEqual(["onSnapshot", "onOps"]);
    expect(snapshotData).not.toBeNull();
    // Verify the snapshot data decodes correctly
    const decoded = new TextDecoder().decode(snapshotData!);
    expect(decoded).toBe(fakePayload);
    expect(receivedOps.length).toBe(1);

    transport.close();
  });

  test("sync-response without snapshot does not call onSnapshot", () => {
    let snapshotCalled = false;

    const transport = createMultiDocTransport({
      url: "ws://localhost:1212/ws",
      clientId: "test",
      onOps: () => {},
      onSnapshot() {
        snapshotCalled = true;
      },
    });

    getLatestWS()._simulateOpen();
    transport.subscribe({ docId: "doc-1" });

    getLatestWS()._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [makeFieldOp("A", 1)],
    }));

    expect(snapshotCalled).toBe(false);
    transport.close();
  });
});
