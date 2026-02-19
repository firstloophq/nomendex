import type { Timestamp } from "./lamport-clock";
import { compareTimestamps } from "./lamport-clock";

export interface LWWRegister<T> {
  readonly value: T;
  readonly timestamp: Timestamp;
}

export function createLWWRegister<T>(params: {
  value: T;
  timestamp: Timestamp;
}): LWWRegister<T> {
  return {
    value: params.value,
    timestamp: params.timestamp,
  };
}

export function setLWWRegister<T>(params: {
  register: LWWRegister<T>;
  value: T;
  timestamp: Timestamp;
}): LWWRegister<T> {
  const cmp = compareTimestamps({
    a: params.timestamp,
    b: params.register.timestamp,
  });

  // New timestamp wins if strictly greater; otherwise keep existing
  if (cmp > 0) {
    return {
      value: params.value,
      timestamp: params.timestamp,
    };
  }

  return params.register;
}
