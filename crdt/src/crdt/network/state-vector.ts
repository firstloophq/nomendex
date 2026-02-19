import type { ClientId } from "../core/client-id";

// StateVector: Map from clientId → highest clock value seen
export type StateVector = ReadonlyMap<ClientId, number>;

export interface MissingRange {
  readonly clientId: ClientId;
  readonly from: number; // inclusive
  readonly to: number; // inclusive
}

export function createStateVector(): StateVector {
  return new Map();
}

export function updateStateVector(params: {
  sv: StateVector;
  clientId: ClientId;
  clock: number;
}): StateVector {
  const current = params.sv.get(params.clientId) ?? 0;
  if (params.clock <= current) return params.sv;
  const next = new Map(params.sv);
  next.set(params.clientId, params.clock);
  return next;
}

/**
 * Compute what operations the remote is missing that local has.
 * Returns ranges of clock values per client that remote needs.
 */
export function missingOps(params: {
  local: StateVector;
  remote: StateVector;
}): ReadonlyArray<MissingRange> {
  const result: Array<MissingRange> = [];

  for (const [clientId, localClock] of params.local) {
    const remoteClock = params.remote.get(clientId) ?? 0;
    if (localClock > remoteClock) {
      result.push({
        clientId,
        from: remoteClock + 1,
        to: localClock,
      });
    }
  }

  return result;
}

// --- Filtering ---

/**
 * Filter ops to only those matching the given missing ranges.
 * Works with any op type that has an `id: { clientId, clock }` field.
 */
export function filterMissingOps<T extends { readonly id: { readonly clientId: string; readonly clock: number } }>(params: {
  ops: ReadonlyArray<T>;
  missing: ReadonlyArray<MissingRange>;
}): ReadonlyArray<T> {
  return params.ops.filter(op =>
    params.missing.some(range =>
      op.id.clientId === range.clientId &&
      op.id.clock >= range.from &&
      op.id.clock <= range.to
    )
  );
}

// --- Serialization ---

export function encodeStateVector(params: {
  sv: StateVector;
}): string {
  const obj: Record<string, number> = {};
  for (const [clientId, clock] of params.sv) {
    obj[clientId] = clock;
  }
  return JSON.stringify(obj);
}

export function decodeStateVector(params: { data: string }): StateVector {
  const obj = JSON.parse(params.data) as Record<string, number>;
  const sv = new Map<ClientId, number>();
  for (const [clientId, clock] of Object.entries(obj)) {
    sv.set(clientId, clock);
  }
  return sv;
}
