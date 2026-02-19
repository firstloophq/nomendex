import type { CRDTRecord, RecordOp } from "./record";
import { createRecord, applyRecordOp } from "./record";

// --- Multi-Document Manager ---
// Routes operations to the correct document by docId.
// All documents (including the board) are CRDTRecords.

export const BOARD_DOC_ID = "__board__";

export interface DocManager {
  readonly docs: ReadonlyMap<string, CRDTRecord>;
}

export function createDocManager(): DocManager {
  return {
    docs: new Map(),
  };
}

export function getOrCreateDoc(params: {
  manager: DocManager;
  docId: string;
}): { manager: DocManager; doc: CRDTRecord } {
  const existing = params.manager.docs.get(params.docId);
  if (existing) {
    return { manager: params.manager, doc: existing };
  }

  const doc = createRecord();
  const newDocs = new Map(params.manager.docs);
  newDocs.set(params.docId, doc);

  return {
    manager: { ...params.manager, docs: newDocs },
    doc,
  };
}

export function applyDocOperation(params: {
  manager: DocManager;
  docId: string;
  op: RecordOp;
}): DocManager {
  const { manager, docId, op } = params;
  const { manager: m, doc } = getOrCreateDoc({ manager, docId });
  const updatedDoc = applyRecordOp({ record: doc, op });
  const newDocs = new Map(m.docs);
  newDocs.set(docId, updatedDoc);

  return { ...m, docs: newDocs };
}

export function getDoc(params: {
  manager: DocManager;
  docId: string;
}): CRDTRecord | undefined {
  return params.manager.docs.get(params.docId);
}

export function listDocIds(params: {
  manager: DocManager;
}): ReadonlyArray<string> {
  return Array.from(params.manager.docs.keys());
}

export function deleteDoc(params: {
  manager: DocManager;
  docId: string;
}): DocManager {
  const newDocs = new Map(params.manager.docs);
  newDocs.delete(params.docId);
  return { ...params.manager, docs: newDocs };
}
