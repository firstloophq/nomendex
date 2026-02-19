export type ClientId = string;

export interface Timestamp {
  readonly clientId: ClientId;
  readonly clock: number;
}

export interface LamportClock {
  readonly clientId: ClientId;
  readonly counter: number;
}

export function createClock(params: { clientId: ClientId }): LamportClock {
  return { clientId: params.clientId, counter: 0 };
}

export function increment(params: {
  clock: LamportClock;
}): { clock: LamportClock; timestamp: Timestamp } {
  const nextCounter = params.clock.counter + 1;
  return {
    clock: { clientId: params.clock.clientId, counter: nextCounter },
    timestamp: { clientId: params.clock.clientId, clock: nextCounter },
  };
}

export function receive(params: {
  clock: LamportClock;
  remoteCounter: number;
}): LamportClock {
  const nextCounter = Math.max(params.clock.counter, params.remoteCounter) + 1;
  return { clientId: params.clock.clientId, counter: nextCounter };
}

export function compareTimestamps(params: {
  a: Timestamp;
  b: Timestamp;
}): number {
  const clockDiff = params.a.clock - params.b.clock;
  if (clockDiff !== 0) return clockDiff;
  if (params.a.clientId < params.b.clientId) return -1;
  if (params.a.clientId > params.b.clientId) return 1;
  return 0;
}
