import type { OperationId } from "./operations";

export interface ORSetEntry<T> {
  readonly value: T;
  readonly id: OperationId;
  readonly removed: boolean;
}

export interface ORSet<T> {
  readonly entries: ReadonlyMap<string, ReadonlyArray<ORSetEntry<T>>>;
}

function entryKey<T>(value: T): string {
  return String(value);
}

function opIdKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}

export function createORSet<T>(): ORSet<T> {
  return { entries: new Map() };
}

export function addToSet<T>(params: {
  set: ORSet<T>;
  value: T;
  id: OperationId;
}): ORSet<T> {
  const key = entryKey(params.value);
  const existing = params.set.entries.get(key) ?? [];

  // Idempotency: if this id already exists, return unchanged
  const newIdKey = opIdKey(params.id);
  if (existing.some((e) => opIdKey(e.id) === newIdKey)) {
    return params.set;
  }

  const newEntry: ORSetEntry<T> = {
    value: params.value,
    id: params.id,
    removed: false,
  };

  const newEntries = new Map(params.set.entries);
  newEntries.set(key, [...existing, newEntry]);

  return { entries: newEntries };
}

export function removeFromSet<T>(params: {
  set: ORSet<T>;
  value: T;
  removeIds: ReadonlyArray<OperationId>;
}): ORSet<T> {
  const key = entryKey(params.value);
  const existing = params.set.entries.get(key);

  if (!existing || existing.length === 0) {
    return params.set;
  }

  const removeKeySet = new Set(params.removeIds.map(opIdKey));

  const updated = existing.map((entry) => {
    if (removeKeySet.has(opIdKey(entry.id))) {
      return { ...entry, removed: true };
    }
    return entry;
  });

  const newEntries = new Map(params.set.entries);
  newEntries.set(key, updated);

  return { entries: newEntries };
}

export function getSetValues<T>(params: { set: ORSet<T> }): ReadonlyArray<T> {
  const values: T[] = [];
  const seen = new Set<string>();

  for (const [key, entries] of params.set.entries) {
    const hasActive = entries.some((e) => !e.removed);
    if (hasActive && !seen.has(key)) {
      seen.add(key);
      // Use the value from the first entry (they all have the same value for a given key)
      values.push(entries[0]!.value);
    }
  }

  return values;
}
