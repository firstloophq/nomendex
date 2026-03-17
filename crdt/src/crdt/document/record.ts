import type { OperationId, Operation } from "../core/operations";
import type { Timestamp } from "../core/lamport-clock";
import type { CRDTDoc } from "../core/apply-operations";
import type { LWWRegister } from "../core/lww-register";
import type { ORSet } from "../core/or-set";
import { createLWWRegister, setLWWRegister } from "../core/lww-register";
import { createORSet, addToSet, removeFromSet, getSetValues } from "../core/or-set";
import { createEmptyDocument, applyOperation, applyOperations, getDocumentText } from "../core/apply-operations";
import { createStateVector, updateStateVector, type StateVector } from "../network/state-vector";

// --- Record Operation Types ---

export interface FieldOp {
  readonly type: "field";
  readonly id: OperationId;
  readonly fieldName: string;
  readonly value: string;
  readonly timestamp: Timestamp;
}

export interface SetOp {
  readonly type: "set";
  readonly id: OperationId;
  readonly fieldName: string;
  readonly action: "add" | "remove";
  readonly value: string;
  readonly removeIds?: ReadonlyArray<OperationId>;
}

export type RecordOp = FieldOp | SetOp | Operation;

// --- CRDT Record ---

export interface CRDTRecord {
  readonly fields: ReadonlyMap<string, LWWRegister<string>>;
  readonly sets: ReadonlyMap<string, ORSet<string>>;
  readonly body: CRDTDoc;
  readonly appliedOps: ReadonlySet<string>;
  readonly stateVector: StateVector;
}

function opKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}

export function createRecord(): CRDTRecord {
  return {
    fields: new Map(),
    sets: new Map(),
    body: createEmptyDocument(),
    appliedOps: new Set(),
    stateVector: createStateVector(),
  };
}

export function applyRecordOp(params: {
  record: CRDTRecord;
  op: RecordOp;
}): CRDTRecord {
  const { record, op } = params;
  const key = opKey(op.id);

  // Idempotency for field and set ops
  if (op.type === "field" || op.type === "set") {
    if (record.appliedOps.has(key)) return record;
  }

  // Update state vector for all op types
  const newSV = updateStateVector({
    sv: record.stateVector,
    clientId: op.id.clientId,
    clock: op.id.clock,
  });

  switch (op.type) {
    case "field": {
      const existing = record.fields.get(op.fieldName);
      const newApplied = new Set(record.appliedOps);
      newApplied.add(key);

      if (existing) {
        const updated = setLWWRegister({
          register: existing,
          value: op.value,
          timestamp: op.timestamp,
        });
        const newFields = new Map(record.fields);
        newFields.set(op.fieldName, updated);
        return { ...record, fields: newFields, appliedOps: newApplied, stateVector: newSV };
      }

      const register = createLWWRegister({
        value: op.value,
        timestamp: op.timestamp,
      });
      const newFields = new Map(record.fields);
      newFields.set(op.fieldName, register);
      return { ...record, fields: newFields, appliedOps: newApplied, stateVector: newSV };
    }

    case "set": {
      const newApplied = new Set(record.appliedOps);
      newApplied.add(key);

      const existing = record.sets.get(op.fieldName) ?? createORSet<string>();
      let updated: ORSet<string>;

      if (op.action === "add") {
        updated = addToSet({ set: existing, value: op.value, id: op.id });
      } else {
        updated = removeFromSet({
          set: existing,
          value: op.value,
          removeIds: op.removeIds ?? [],
        });
      }

      const newSets = new Map(record.sets);
      newSets.set(op.fieldName, updated);
      return { ...record, sets: newSets, appliedOps: newApplied, stateVector: newSV };
    }

    // Body operations — delegate to existing CRDT engine
    case "insert":
    case "delete":
    case "delete_batch":
    case "format":
    case "attr_update":
    case "reparent": {
      const newBody = applyOperation({ doc: record.body, op });
      return { ...record, body: newBody, stateVector: newSV };
    }
  }
}

export function applyRecordOps(params: {
  record: CRDTRecord;
  ops: ReadonlyArray<RecordOp>;
}): CRDTRecord {
  if (params.ops.length === 0) return params.record;

  const allBodyOps = params.ops.every((op) =>
    op.type === "insert"
    || op.type === "delete"
    || op.type === "delete_batch"
    || op.type === "format"
    || op.type === "attr_update"
    || op.type === "reparent"
  );

  if (allBodyOps) {
    const bodyOps = params.ops as ReadonlyArray<Operation>;
    const newBody = applyOperations({ doc: params.record.body, ops: bodyOps });
    let newSV = params.record.stateVector;
    for (const op of params.ops) {
      newSV = updateStateVector({
        sv: newSV,
        clientId: op.id.clientId,
        clock: op.id.clock,
      });
    }
    if (newBody === params.record.body && newSV === params.record.stateVector) {
      return params.record;
    }
    return {
      ...params.record,
      body: newBody,
      stateVector: newSV,
    };
  }

  let record = params.record;
  for (const op of params.ops) {
    record = applyRecordOp({ record, op });
  }
  return record;
}

export function getField(params: {
  record: CRDTRecord;
  fieldName: string;
}): string | undefined {
  const reg = params.record.fields.get(params.fieldName);
  return reg?.value;
}

export function getFields(params: {
  record: CRDTRecord;
}): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [name, reg] of params.record.fields) {
    result.set(name, reg.value);
  }
  return result;
}

export function getSetField(params: {
  record: CRDTRecord;
  fieldName: string;
}): ReadonlyArray<string> {
  const set = params.record.sets.get(params.fieldName);
  if (!set) return [];
  return getSetValues({ set });
}

export function getBodyText(params: { record: CRDTRecord }): string {
  return getDocumentText({ doc: params.record.body });
}
