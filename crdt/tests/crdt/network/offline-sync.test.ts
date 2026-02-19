import { describe, expect, it } from "bun:test";
import {
  createEmptyDocument,
  applyOperation,
  applyOperations,
  getDocumentText,
} from "@/crdt/core/apply-operations";
import type { CRDTDoc } from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createDeleteOp,
  createOperationId,
} from "@/crdt/core/operations";
import type { Operation } from "@/crdt/core/operations";
import {
  missingOps,
  encodeStateVector,
  decodeStateVector,
} from "@/crdt/network/state-vector";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

function makeTextOp(params: {
  client: string;
  clock: number;
  leftOrigin: ReturnType<typeof makeId> | null;
  char: string;
}): Operation {
  return createInsertOp({
    id: makeId(params.client, params.clock),
    parentId: params.leftOrigin,
    side: "right",
    content: { type: "text", value: params.char },
  });
}

/**
 * Simulate server-side sync: given the server's doc and allOps,
 * and a client's state vector, compute what ops the client is missing.
 */
function serverComputeMissing(params: {
  serverDoc: CRDTDoc;
  allOps: ReadonlyArray<Operation>;
  clientStateVector: string;
}): ReadonlyArray<Operation> {
  const remoteStateVector = decodeStateVector({ data: params.clientStateVector });
  const missing = missingOps({ local: params.serverDoc.stateVector, remote: remoteStateVector });

  return params.allOps.filter(op =>
    missing.some(range =>
      op.id.clientId === range.clientId &&
      op.id.clock >= range.from &&
      op.id.clock <= range.to
    )
  );
}

describe("Offline Sync", () => {
  describe("basic offline queue", () => {
    it("ops generated while offline are collected for later send", () => {
      // Simulate: client has a doc with "hello", goes offline, types " world"
      let clientDoc = createEmptyDocument();
      const initialOps: Array<Operation> = [];

      // Build "hello"
      for (let i = 0; i < 5; i++) {
        const char = "hello"[i]!;
        const op = makeTextOp({
          client: "A",
          clock: i + 1,
          leftOrigin: i > 0 ? makeId("A", i) : null,
          char,
        });
        initialOps.push(op);
        clientDoc = applyOperation({ doc: clientDoc, op });
      }

      expect(getDocumentText({ doc: clientDoc })).toBe("hello");

      // Client goes offline — ops are queued in pendingOps (simulated as array)
      const pendingOps: Array<Operation> = [];

      // Type " world" while offline
      const offlineChars = " world";
      for (let i = 0; i < offlineChars.length; i++) {
        const op = makeTextOp({
          client: "A",
          clock: 6 + i,
          leftOrigin: makeId("A", 5 + i),
          char: offlineChars[i]!,
        });
        pendingOps.push(op);
        clientDoc = applyOperation({ doc: clientDoc, op });
      }

      expect(getDocumentText({ doc: clientDoc })).toBe("hello world");
      expect(pendingOps.length).toBe(6);

      // Verify the state vector reflects all local ops
      expect(clientDoc.stateVector.get("A")).toBe(11);
    });
  });

  describe("sync protocol", () => {
    it("client sends state vector, server responds with missing ops", () => {
      // Server has "hello" from client A
      let serverDoc = createEmptyDocument();
      const allOps: Array<Operation> = [];

      for (let i = 0; i < 5; i++) {
        const op = makeTextOp({
          client: "A",
          clock: i + 1,
          leftOrigin: i > 0 ? makeId("A", i) : null,
          char: "hello"[i]!,
        });
        allOps.push(op);
        serverDoc = applyOperation({ doc: serverDoc, op });
      }

      // Server also has " there" from client B
      for (let i = 0; i < 6; i++) {
        const op = makeTextOp({
          client: "B",
          clock: i + 1,
          leftOrigin: i > 0 ? makeId("B", i) : makeId("A", 5),
          char: " there"[i]!,
        });
        allOps.push(op);
        serverDoc = applyOperation({ doc: serverDoc, op });
      }

      // Client A only has its own "hello" — state vector: { A: 5 }
      const clientSV = encodeStateVector({ sv: new Map([["A", 5]]) });

      const missingForClient = serverComputeMissing({
        serverDoc,
        allOps,
        clientStateVector: clientSV,
      });

      // Should get B's 6 ops
      expect(missingForClient.length).toBe(6);
      expect(missingForClient.every(op => op.id.clientId === "B")).toBe(true);
    });

    it("returns empty array when client is fully up to date", () => {
      let serverDoc = createEmptyDocument();
      const allOps: Array<Operation> = [];

      const op = makeTextOp({ client: "A", clock: 1, leftOrigin: null, char: "x" });
      allOps.push(op);
      serverDoc = applyOperation({ doc: serverDoc, op });

      const clientSV = encodeStateVector({ sv: new Map([["A", 1]]) });

      const missing = serverComputeMissing({ serverDoc, allOps, clientStateVector: clientSV });
      expect(missing.length).toBe(0);
    });
  });

  describe("bidirectional merge", () => {
    it("client offline ops + server ops from other client merge correctly", () => {
      // Shared base: "hi" from shared-init
      const baseOps: Array<Operation> = [
        makeTextOp({ client: "shared", clock: 1, leftOrigin: null, char: "h" }),
        makeTextOp({ client: "shared", clock: 2, leftOrigin: makeId("shared", 1), char: "i" }),
      ];

      // Build server doc with base
      let serverDoc = createEmptyDocument();
      const serverAllOps: Array<Operation> = [];
      for (const op of baseOps) {
        serverDoc = applyOperation({ doc: serverDoc, op });
        serverAllOps.push(op);
      }

      // Client A starts with same base
      let clientADoc = createEmptyDocument();
      for (const op of baseOps) {
        clientADoc = applyOperation({ doc: clientADoc, op });
      }

      // Client B types " bob" on the server
      const clientBOps: Array<Operation> = [];
      for (let i = 0; i < 4; i++) {
        const op = makeTextOp({
          client: "B",
          clock: i + 1,
          leftOrigin: i > 0 ? makeId("B", i) : makeId("shared", 2),
          char: " bob"[i]!,
        });
        clientBOps.push(op);
        serverDoc = applyOperation({ doc: serverDoc, op });
        serverAllOps.push(op);
      }

      expect(getDocumentText({ doc: serverDoc })).toBe("hi bob");

      // Client A types "!" offline (after "i")
      const clientAOfflineOps: Array<Operation> = [
        makeTextOp({ client: "A", clock: 1, leftOrigin: makeId("shared", 2), char: "!" }),
      ];
      for (const op of clientAOfflineOps) {
        clientADoc = applyOperation({ doc: clientADoc, op });
      }

      expect(getDocumentText({ doc: clientADoc })).toBe("hi!");

      // Reconnect: simulate sync
      // 1. Client A sends its state vector
      const clientASV = encodeStateVector({ sv: clientADoc.stateVector });

      // 2. Server computes missing ops for client A
      const missingForA = serverComputeMissing({
        serverDoc,
        allOps: serverAllOps,
        clientStateVector: clientASV,
      });

      // 3. Client A applies missing ops (B's changes)
      clientADoc = applyOperations({ doc: clientADoc, ops: missingForA });

      // 4. Server applies client A's offline ops
      for (const op of clientAOfflineOps) {
        serverDoc = applyOperation({ doc: serverDoc, op });
        serverAllOps.push(op);
      }

      // Both should converge
      const clientText = getDocumentText({ doc: clientADoc });
      const serverText = getDocumentText({ doc: serverDoc });
      expect(clientText).toBe(serverText);

      // Both should contain all characters
      expect(clientText).toContain("hi");
      expect(clientText).toContain("!");
      expect(clientText).toContain("bob");
    });
  });

  describe("idempotency", () => {
    it("applying same ops twice produces the same result", () => {
      let doc = createEmptyDocument();
      const ops = [
        makeTextOp({ client: "A", clock: 1, leftOrigin: null, char: "a" }),
        makeTextOp({ client: "A", clock: 2, leftOrigin: makeId("A", 1), char: "b" }),
        makeTextOp({ client: "B", clock: 1, leftOrigin: null, char: "x" }),
      ];

      // Apply once
      doc = applyOperations({ doc, ops });
      const textAfterFirst = getDocumentText({ doc });

      // Apply again — should be idempotent
      doc = applyOperations({ doc, ops });
      const textAfterSecond = getDocumentText({ doc });

      expect(textAfterFirst).toBe(textAfterSecond);
    });

    it("re-syncing after full sync produces no changes", () => {
      let serverDoc = createEmptyDocument();
      const allOps: Array<Operation> = [];

      // Server has ops from A and B
      const opsA = [
        makeTextOp({ client: "A", clock: 1, leftOrigin: null, char: "a" }),
        makeTextOp({ client: "A", clock: 2, leftOrigin: makeId("A", 1), char: "b" }),
      ];
      const opsB = [
        makeTextOp({ client: "B", clock: 1, leftOrigin: null, char: "x" }),
      ];

      for (const op of [...opsA, ...opsB]) {
        serverDoc = applyOperation({ doc: serverDoc, op });
        allOps.push(op);
      }

      // Client fully synced — has everything
      const clientSV = encodeStateVector({ sv: serverDoc.stateVector });
      const missing = serverComputeMissing({ serverDoc, allOps, clientStateVector: clientSV });

      expect(missing.length).toBe(0);
    });
  });

  describe("buffer during sync", () => {
    it("ops arriving during sync phase are applied after sync response", () => {
      // Simulate the scenario where:
      // 1. Client reconnects, sends sync request
      // 2. During sync, new ops arrive from another client
      // 3. Sync response arrives with older missing ops
      // 4. Buffered ops are applied after sync response

      // Initial state: server has "ab" from A
      let serverDoc = createEmptyDocument();
      const allOps: Array<Operation> = [];

      const initialOps = [
        makeTextOp({ client: "A", clock: 1, leftOrigin: null, char: "a" }),
        makeTextOp({ client: "A", clock: 2, leftOrigin: makeId("A", 1), char: "b" }),
      ];

      for (const op of initialOps) {
        serverDoc = applyOperation({ doc: serverDoc, op });
        allOps.push(op);
      }

      // Client was offline and only had "a" (clock: 1)
      let clientDoc = createEmptyDocument();
      clientDoc = applyOperation({ doc: clientDoc, op: initialOps[0]! });

      // Step 1: Client sends state vector (only has A:1)
      const clientSV = encodeStateVector({ sv: clientDoc.stateVector });

      // Step 2: While waiting for sync response, a new op arrives from B
      const newOpDuringSyncPhase = makeTextOp({
        client: "B",
        clock: 1,
        leftOrigin: makeId("A", 2),
        char: "c",
      });

      // This op would be buffered (simulated)
      const bufferedOps = [newOpDuringSyncPhase];

      // Also apply to server
      serverDoc = applyOperation({ doc: serverDoc, op: newOpDuringSyncPhase });
      allOps.push(newOpDuringSyncPhase);

      // Step 3: Sync response arrives with missing ops (A:2)
      const syncResponseOps = serverComputeMissing({
        serverDoc: applyOperations({ doc: createEmptyDocument(), ops: allOps.slice(0, 2) }),
        allOps: allOps.slice(0, 2),
        clientStateVector: clientSV,
      });

      // Apply sync response ops
      clientDoc = applyOperations({ doc: clientDoc, ops: syncResponseOps });

      // Step 4: Apply buffered ops
      clientDoc = applyOperations({ doc: clientDoc, ops: bufferedOps });

      // Client should have "abc" (same as server)
      expect(getDocumentText({ doc: clientDoc })).toBe(getDocumentText({ doc: serverDoc }));
    });
  });

  describe("state vector serialization round-trip", () => {
    it("encode/decode preserves state vector", () => {
      const sv = new Map<string, number>([
        ["A", 5],
        ["B", 3],
        ["shared-init", 1],
      ]);

      const encoded = encodeStateVector({ sv });
      const decoded = decodeStateVector({ data: encoded });

      expect(decoded.get("A")).toBe(5);
      expect(decoded.get("B")).toBe(3);
      expect(decoded.get("shared-init")).toBe(1);
      expect(decoded.size).toBe(3);
    });
  });

  describe("partial sync", () => {
    it("client missing some ops from multiple clients gets exactly those ops", () => {
      let serverDoc = createEmptyDocument();
      const allOps: Array<Operation> = [];

      // A has 5 ops, B has 3 ops, C has 2 ops
      for (let i = 1; i <= 5; i++) {
        const op = makeTextOp({
          client: "A",
          clock: i,
          leftOrigin: i > 1 ? makeId("A", i - 1) : null,
          char: String.fromCharCode(96 + i), // a, b, c, d, e
        });
        allOps.push(op);
        serverDoc = applyOperation({ doc: serverDoc, op });
      }

      for (let i = 1; i <= 3; i++) {
        const op = makeTextOp({
          client: "B",
          clock: i,
          leftOrigin: i > 1 ? makeId("B", i - 1) : makeId("A", 5),
          char: String.fromCharCode(119 + i), // x, y, z
        });
        allOps.push(op);
        serverDoc = applyOperation({ doc: serverDoc, op });
      }

      for (let i = 1; i <= 2; i++) {
        const op = makeTextOp({
          client: "C",
          clock: i,
          leftOrigin: i > 1 ? makeId("C", i - 1) : makeId("B", 3),
          char: String(i),
        });
        allOps.push(op);
        serverDoc = applyOperation({ doc: serverDoc, op });
      }

      // Client has A:3, B:1 — missing A:4-5, B:2-3, all of C
      const clientSV = encodeStateVector({
        sv: new Map([["A", 3], ["B", 1]]),
      });

      const missing = serverComputeMissing({ serverDoc, allOps, clientStateVector: clientSV });

      // Should get: A:4, A:5, B:2, B:3, C:1, C:2 = 6 ops
      expect(missing.length).toBe(6);

      const aOps = missing.filter(op => op.id.clientId === "A");
      const bOps = missing.filter(op => op.id.clientId === "B");
      const cOps = missing.filter(op => op.id.clientId === "C");

      expect(aOps.length).toBe(2);
      expect(aOps[0]!.id.clock).toBe(4);
      expect(aOps[1]!.id.clock).toBe(5);

      expect(bOps.length).toBe(2);
      expect(bOps[0]!.id.clock).toBe(2);
      expect(bOps[1]!.id.clock).toBe(3);

      expect(cOps.length).toBe(2);
    });
  });
});
