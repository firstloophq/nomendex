import type { ClientId } from "../core/client-id";

// --- Types ---

export interface CursorPosition {
  readonly anchor: number;
  readonly head: number;
}

export interface UserInfo {
  readonly name: string;
  readonly color: string;
}

export interface AwarenessState {
  readonly cursor?: CursorPosition;
  readonly viewingDocId?: string;
  readonly user: UserInfo;
  readonly lastUpdated: number;
}

export interface Awareness {
  readonly localClientId: ClientId;
  readonly states: ReadonlyMap<ClientId, AwarenessState>;
}

// --- Create ---

export function createAwareness(params: { clientId: ClientId }): Awareness {
  return {
    localClientId: params.clientId,
    states: new Map(),
  };
}

// --- Local state ---

export function setLocalState(params: {
  awareness: Awareness;
  cursor?: CursorPosition;
  viewingDocId?: string;
  user: UserInfo;
}): Awareness {
  const newStates = new Map(params.awareness.states);
  newStates.set(params.awareness.localClientId, {
    cursor: params.cursor,
    viewingDocId: params.viewingDocId,
    user: params.user,
    lastUpdated: Date.now(),
  });
  return { ...params.awareness, states: newStates };
}

// --- Remote state ---

export function applyRemoteState(params: {
  awareness: Awareness;
  clientId: ClientId;
  state: AwarenessState;
}): Awareness {
  const newStates = new Map(params.awareness.states);
  newStates.set(params.clientId, params.state);
  return { ...params.awareness, states: newStates };
}

// --- Stale removal ---

export function removeStaleStates(params: {
  awareness: Awareness;
  timeoutMs: number;
}): Awareness {
  const now = Date.now();
  const newStates = new Map<ClientId, AwarenessState>();
  for (const [clientId, state] of params.awareness.states) {
    // Never remove local state
    if (
      clientId === params.awareness.localClientId ||
      now - state.lastUpdated < params.timeoutMs
    ) {
      newStates.set(clientId, state);
    }
  }
  return { ...params.awareness, states: newStates };
}

// --- Query ---

export function getStates(params: {
  awareness: Awareness;
}): ReadonlyMap<ClientId, AwarenessState> {
  return params.awareness.states;
}

// --- Serialization ---

export function encodeAwareness(params: {
  awareness: Awareness;
  clientId: ClientId;
}): Uint8Array {
  const state = params.awareness.states.get(params.clientId);
  if (!state) return new Uint8Array(0);

  const data = {
    clientId: params.clientId,
    state,
  };
  return new TextEncoder().encode(JSON.stringify(data));
}

export function decodeAwareness(params: {
  data: Uint8Array;
}): { clientId: ClientId; state: AwarenessState } {
  const json = new TextDecoder().decode(params.data);
  return JSON.parse(json) as { clientId: ClientId; state: AwarenessState };
}
