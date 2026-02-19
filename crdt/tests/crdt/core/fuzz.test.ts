import { describe, expect, it } from "bun:test";
import {
  createEmptyDocument,
  applyOperation,
  getDocumentText,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createDeleteOp,
  createOperationId,
  type Operation,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

// Seeded pseudo-random for determinism
function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffle<T>(arr: Array<T>, rng: () => number): Array<T> {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function generateRandomOps(params: {
  clientId: string;
  opCount: number;
  rng: () => number;
}): Array<Operation> {
  const { clientId, opCount, rng } = params;
  const ops: Array<Operation> = [];
  const insertedIds: Array<{ clientId: string; clock: number }> = [];
  let clock = 0;

  for (let i = 0; i < opCount; i++) {
    clock++;
    const shouldDelete = insertedIds.length > 3 && rng() < 0.3;

    if (shouldDelete) {
      const targetIdx = Math.floor(rng() * insertedIds.length);
      const targetId = insertedIds[targetIdx]!;
      ops.push(
        createDeleteOp({
          id: makeId(clientId, clock),
          targetId: makeId(targetId.clientId, targetId.clock),
        })
      );
    } else {
      const parentId =
        insertedIds.length > 0 && rng() > 0.2
          ? insertedIds[Math.floor(rng() * insertedIds.length)]!
          : null;
      const op = createInsertOp({
        id: makeId(clientId, clock),
        parentId: parentId
          ? makeId(parentId.clientId, parentId.clock)
          : null,
        side: "right",
        content: {
          type: "text",
          value: String.fromCharCode(97 + Math.floor(rng() * 26)),
        },
      });
      ops.push(op);
      insertedIds.push({ clientId, clock });
    }
  }

  return ops;
}

function applyOpsToDoc(ops: ReadonlyArray<Operation>): CRDTDoc {
  let doc = createEmptyDocument();
  for (const op of ops) {
    doc = applyOperation({ doc, op });
  }
  return doc;
}

describe("Fuzz Testing — CRDT Convergence", () => {
  it("2 clients, 100 ops each, converge after all ops synced", () => {
    const rng = createRng(42);
    const opsA = generateRandomOps({ clientId: "A", opCount: 100, rng });
    const opsB = generateRandomOps({ clientId: "B", opCount: 100, rng });

    const allOps = [...opsA, ...opsB];

    // Apply in original order
    const doc1 = applyOpsToDoc(allOps);

    // Apply in reverse order
    const doc2 = applyOpsToDoc([...allOps].reverse());

    // Apply in shuffled order
    const doc3 = applyOpsToDoc(shuffle(allOps, createRng(123)));

    const text1 = getDocumentText({ doc: doc1 });
    const text2 = getDocumentText({ doc: doc2 });
    const text3 = getDocumentText({ doc: doc3 });

    expect(text1).toBe(text2);
    expect(text2).toBe(text3);
  });

  it("3 clients, 50 ops each, converge", () => {
    const rng = createRng(99);
    const opsA = generateRandomOps({ clientId: "A", opCount: 50, rng });
    const opsB = generateRandomOps({ clientId: "B", opCount: 50, rng });
    const opsC = generateRandomOps({ clientId: "C", opCount: 50, rng });

    const allOps = [...opsA, ...opsB, ...opsC];

    const doc1 = applyOpsToDoc(allOps);
    const doc2 = applyOpsToDoc(shuffle(allOps, createRng(1)));
    const doc3 = applyOpsToDoc(shuffle(allOps, createRng(2)));
    const doc4 = applyOpsToDoc(shuffle(allOps, createRng(3)));

    const text1 = getDocumentText({ doc: doc1 });
    expect(getDocumentText({ doc: doc2 })).toBe(text1);
    expect(getDocumentText({ doc: doc3 })).toBe(text1);
    expect(getDocumentText({ doc: doc4 })).toBe(text1);
  });

  it("5 clients, 30 ops each, converge", () => {
    const rng = createRng(777);
    const clientOps = ["A", "B", "C", "D", "E"].map((clientId) =>
      generateRandomOps({ clientId, opCount: 30, rng })
    );
    const allOps = clientOps.flat();

    const doc1 = applyOpsToDoc(allOps);
    const doc2 = applyOpsToDoc(shuffle(allOps, createRng(10)));
    const doc3 = applyOpsToDoc(shuffle(allOps, createRng(20)));

    const text1 = getDocumentText({ doc: doc1 });
    expect(getDocumentText({ doc: doc2 })).toBe(text1);
    expect(getDocumentText({ doc: doc3 })).toBe(text1);
  });

  it("10 clients, 20 ops each, converge", () => {
    const rng = createRng(1337);
    const clients = Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i));
    const clientOps = clients.map((clientId) =>
      generateRandomOps({ clientId, opCount: 20, rng })
    );
    const allOps = clientOps.flat();

    const doc1 = applyOpsToDoc(allOps);
    const doc2 = applyOpsToDoc(shuffle(allOps, createRng(50)));
    const doc3 = applyOpsToDoc(shuffle(allOps, createRng(100)));

    const text1 = getDocumentText({ doc: doc1 });
    expect(getDocumentText({ doc: doc2 })).toBe(text1);
    expect(getDocumentText({ doc: doc3 })).toBe(text1);
  });

  it("mostly inserts converge", () => {
    const rng = createRng(555);
    // Override to almost never delete
    const opsA: Array<Operation> = [];
    const opsB: Array<Operation> = [];
    for (let i = 1; i <= 100; i++) {
      opsA.push(
        createInsertOp({
          id: makeId("A", i),
          parentId: i > 1 ? makeId("A", i - 1) : null,
          side: "right",
          content: { type: "text", value: String.fromCharCode(97 + (i % 26)) },
        })
      );
      opsB.push(
        createInsertOp({
          id: makeId("B", i),
          parentId: i > 1 ? makeId("B", i - 1) : null,
          side: "right",
          content: { type: "text", value: String.fromCharCode(65 + (i % 26)) },
        })
      );
    }

    const allOps = [...opsA, ...opsB];
    const doc1 = applyOpsToDoc(allOps);
    const doc2 = applyOpsToDoc(shuffle(allOps, createRng(42)));
    const doc3 = applyOpsToDoc([...allOps].reverse());

    const text1 = getDocumentText({ doc: doc1 });
    expect(getDocumentText({ doc: doc2 })).toBe(text1);
    expect(getDocumentText({ doc: doc3 })).toBe(text1);
    expect(text1.length).toBe(200);
  });

  it("1000 iterations of random 2-client scenarios converge", () => {
    for (let seed = 0; seed < 1000; seed++) {
      const rng = createRng(seed);
      const opsA = generateRandomOps({ clientId: "A", opCount: 10, rng });
      const opsB = generateRandomOps({ clientId: "B", opCount: 10, rng });
      const allOps = [...opsA, ...opsB];

      const doc1 = applyOpsToDoc(allOps);
      const doc2 = applyOpsToDoc(shuffle(allOps, createRng(seed + 10000)));

      const text1 = getDocumentText({ doc: doc1 });
      const text2 = getDocumentText({ doc: doc2 });

      if (text1 !== text2) {
        throw new Error(
          `Convergence failure at seed=${seed}: "${text1}" vs "${text2}"`
        );
      }
    }
  });
});
