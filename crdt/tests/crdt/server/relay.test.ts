import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createCRDTRelay, type CRDTRelay } from "@/crdt/server/relay";
import { createOperationId } from "@/crdt/core/operations";
import type { FieldOp, RecordOp } from "@/crdt/document/record";

// --- Mock WebSocket (same pattern as multi-doc-transport tests) ---

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

let originalWebSocket: typeof globalThis.WebSocket;

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

/** Helper to create a mock client for the local handler */
function createMockClient(id: string) {
  const messages: string[] = [];
  return {
    id,
    messages,
    send(message: string) {
      messages.push(message);
    },
  };
}

describe("createCRDTRelay", () => {
  beforeEach(() => {
    mockWSInstances = [];
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = createMockWSClass() as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  function getRemoteWS(): MockWS {
    return mockWSInstances[mockWSInstances.length - 1]!;
  }

  test("creates a relay with handler and remote transport", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    expect(relay.handler).toBeDefined();
    expect(relay.getDocIds()).toEqual(["doc-1"]);
    relay.close();
  });

  test("subscribes to relayed docs on remote connect", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1", "doc-2"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();

    // Should have sent subscribe messages for both docs
    const subscribeMessages = ws.sentMessages
      .map((m) => JSON.parse(m) as { type: string; docId: string })
      .filter((m) => m.type === "subscribe");
    expect(subscribeMessages.length).toBe(2);
    expect(subscribeMessages.map((m) => m.docId).sort()).toEqual(["doc-1", "doc-2"]);

    relay.close();
  });

  test("forwards local client ops to remote", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();

    // Simulate sync-response so transport exits sync mode
    ws.sentMessages.length = 0;
    ws._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [],
    }));

    // Local client connects and sends ops
    const localClient = createMockClient("local-1");
    relay.handler.handleOpen({ client: localClient });
    relay.handler.handleMessage({
      client: localClient,
      message: JSON.stringify({ type: "subscribe", docId: "doc-1" }),
    });
    localClient.messages.length = 0;

    const op = makeFieldOp({ clientId: "local-1", clock: 1, fieldName: "title", value: "Hello" });
    relay.handler.handleMessage({
      client: localClient,
      message: JSON.stringify({ type: "ops", docId: "doc-1", ops: [op] }),
    });

    // The relay should have forwarded the op to the remote transport
    const remoteOpsMessages = ws.sentMessages
      .map((m) => JSON.parse(m) as { type: string; docId: string; ops?: ReadonlyArray<RecordOp> })
      .filter((m) => m.type === "ops" && m.docId === "doc-1");
    expect(remoteOpsMessages.length).toBe(1);
    expect(remoteOpsMessages[0]!.ops!.length).toBe(1);

    relay.close();
  });

  test("forwards remote ops to local handler and broadcasts to local clients", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();

    // Complete sync first
    ws._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [],
    }));

    // Local client subscribes
    const localClient = createMockClient("local-1");
    relay.handler.handleOpen({ client: localClient });
    relay.handler.handleMessage({
      client: localClient,
      message: JSON.stringify({ type: "subscribe", docId: "doc-1" }),
    });
    localClient.messages.length = 0;

    // Remote sends ops
    const remoteOp = makeFieldOp({ clientId: "remote-user", clock: 5, fieldName: "title", value: "Remote Title" });
    ws._simulateMessage(JSON.stringify({
      type: "ops",
      docId: "doc-1",
      ops: [remoteOp],
    }));

    // Local client should receive the broadcast
    expect(localClient.messages.length).toBe(1);
    const msg = JSON.parse(localClient.messages[0]!) as { type: string; docId: string; ops: ReadonlyArray<RecordOp> };
    expect(msg.type).toBe("ops");
    expect(msg.docId).toBe("doc-1");
    expect(msg.ops.length).toBe(1);

    // Handler's doc manager should have the op applied
    const { getDoc } = require("@/crdt/document/doc-manager");
    const { getField } = require("@/crdt/document/record");
    const record = getDoc({ manager: relay.handler.getDocManagerState().manager, docId: "doc-1" });
    expect(getField({ record, fieldName: "title" })).toBe("Remote Title");

    relay.close();
  });

  test("does not echo remote ops back to remote", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();

    // Complete sync
    ws._simulateMessage(JSON.stringify({
      type: "sync-response",
      docId: "doc-1",
      ops: [],
    }));
    ws.sentMessages.length = 0;

    // Remote sends ops
    const remoteOp = makeFieldOp({ clientId: "remote-user", clock: 1, fieldName: "title", value: "From Remote" });
    ws._simulateMessage(JSON.stringify({
      type: "ops",
      docId: "doc-1",
      ops: [remoteOp],
    }));

    // Should NOT have sent any ops back to remote (would cause echo loop)
    const opsMessages = ws.sentMessages
      .map((m) => JSON.parse(m) as { type: string })
      .filter((m) => m.type === "ops");
    expect(opsMessages.length).toBe(0);

    relay.close();
  });

  test("ignores ops for non-relayed docs", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();
    ws._simulateMessage(JSON.stringify({ type: "sync-response", docId: "doc-1", ops: [] }));

    // Local client sends ops for a non-relayed doc
    const localClient = createMockClient("local-1");
    relay.handler.handleOpen({ client: localClient });
    relay.handler.handleMessage({
      client: localClient,
      message: JSON.stringify({ type: "subscribe", docId: "doc-99" }),
    });

    ws.sentMessages.length = 0;
    const op = makeFieldOp({ clientId: "local-1", clock: 1, fieldName: "x", value: "y" });
    relay.handler.handleMessage({
      client: localClient,
      message: JSON.stringify({ type: "ops", docId: "doc-99", ops: [op] }),
    });

    // Should NOT forward to remote
    const opsMessages = ws.sentMessages
      .map((m) => JSON.parse(m) as { type: string })
      .filter((m) => m.type === "ops");
    expect(opsMessages.length).toBe(0);

    relay.close();
  });

  test("addDoc subscribes to remote", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
    });

    const ws = getRemoteWS();
    ws._simulateOpen();
    ws.sentMessages.length = 0;

    relay.addDoc({ docId: "new-doc" });

    const subscribeMessages = ws.sentMessages
      .map((m) => JSON.parse(m) as { type: string; docId: string })
      .filter((m) => m.type === "subscribe");
    expect(subscribeMessages.length).toBe(1);
    expect(subscribeMessages[0]!.docId).toBe("new-doc");
    expect(relay.getDocIds()).toContain("new-doc");

    relay.close();
  });

  test("removeDoc unsubscribes from remote", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();
    ws.sentMessages.length = 0;

    relay.removeDoc({ docId: "doc-1" });

    const unsubMessages = ws.sentMessages
      .map((m) => JSON.parse(m) as { type: string; docId: string })
      .filter((m) => m.type === "unsubscribe");
    expect(unsubMessages.length).toBe(1);
    expect(unsubMessages[0]!.docId).toBe("doc-1");
    expect(relay.getDocIds()).not.toContain("doc-1");

    relay.close();
  });

  test("isConnected reflects remote transport state", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
    });

    expect(relay.isConnected()).toBe(false);

    const ws = getRemoteWS();
    ws._simulateOpen();
    expect(relay.isConnected()).toBe(true);

    relay.close();
  });

  test("forwards remote awareness to local clients", () => {
    const relay = createCRDTRelay({
      remoteUrl: "ws://remote:8080/ws",
      clientId: "relay-1",
      docIds: ["doc-1"],
    });

    const ws = getRemoteWS();
    ws._simulateOpen();
    ws._simulateMessage(JSON.stringify({ type: "sync-response", docId: "doc-1", ops: [] }));

    // Local client subscribes
    const localClient = createMockClient("local-1");
    relay.handler.handleOpen({ client: localClient });
    relay.handler.handleMessage({
      client: localClient,
      message: JSON.stringify({ type: "subscribe", docId: "doc-1" }),
    });
    localClient.messages.length = 0;

    // Remote sends awareness
    ws._simulateMessage(JSON.stringify({
      type: "awareness",
      docId: "doc-1",
      clientId: "remote-user",
      state: { user: { name: "Remote", color: "#ff0000" }, lastUpdated: Date.now() },
    }));

    // Local client should receive the awareness
    expect(localClient.messages.length).toBe(1);
    const msg = JSON.parse(localClient.messages[0]!) as { type: string; clientId: string };
    expect(msg.type).toBe("awareness");
    expect(msg.clientId).toBe("remote-user");

    relay.close();
  });
});
