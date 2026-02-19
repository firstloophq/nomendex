import { describe, expect, it } from "bun:test";
import {
  createAwareness,
  setLocalState,
  applyRemoteState,
  removeStaleStates,
  encodeAwareness,
  decodeAwareness,
  getStates,
} from "@/crdt/network/awareness";

describe("Awareness Protocol", () => {
  describe("setLocalState", () => {
    it("sets cursor and user info", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        cursor: { anchor: 5, head: 5 },
        user: { name: "Alice", color: "#ff0000" },
      });

      const states = getStates({ awareness });
      expect(states.get("A")).toBeDefined();
      expect(states.get("A")!.cursor).toEqual({ anchor: 5, head: 5 });
      expect(states.get("A")!.user.name).toBe("Alice");
    });
  });

  describe("applyRemoteState", () => {
    it("adds a remote client's state", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = applyRemoteState({
        awareness,
        clientId: "B",
        state: {
          cursor: { anchor: 10, head: 12 },
          user: { name: "Bob", color: "#0000ff" },
          lastUpdated: Date.now(),
        },
      });

      const states = getStates({ awareness });
      expect(states.size).toBe(1);
      expect(states.get("B")!.user.name).toBe("Bob");
    });
  });

  describe("removeStaleStates", () => {
    it("removes states older than timeout", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = applyRemoteState({
        awareness,
        clientId: "B",
        state: {
          cursor: { anchor: 10, head: 12 },
          user: { name: "Bob", color: "#0000ff" },
          lastUpdated: Date.now() - 60000, // 60 seconds ago
        },
      });

      awareness = removeStaleStates({ awareness, timeoutMs: 30000 });
      const states = getStates({ awareness });
      expect(states.has("B")).toBe(false);
    });

    it("keeps fresh states", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = applyRemoteState({
        awareness,
        clientId: "B",
        state: {
          cursor: { anchor: 10, head: 12 },
          user: { name: "Bob", color: "#0000ff" },
          lastUpdated: Date.now(),
        },
      });

      awareness = removeStaleStates({ awareness, timeoutMs: 30000 });
      const states = getStates({ awareness });
      expect(states.has("B")).toBe(true);
    });
  });

  describe("serialization", () => {
    it("round-trips through encode/decode", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        cursor: { anchor: 5, head: 5 },
        user: { name: "Alice", color: "#ff0000" },
      });

      const encoded = encodeAwareness({ awareness, clientId: "A" });
      const decoded = decodeAwareness({ data: encoded });

      expect(decoded.clientId).toBe("A");
      expect(decoded.state.cursor).toEqual({ anchor: 5, head: 5 });
      expect(decoded.state.user.name).toBe("Alice");
    });
  });

  describe("multiple clients", () => {
    it("tracks multiple remote cursors", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        cursor: { anchor: 0, head: 0 },
        user: { name: "Alice", color: "#ff0000" },
      });
      awareness = applyRemoteState({
        awareness,
        clientId: "B",
        state: {
          cursor: { anchor: 5, head: 5 },
          user: { name: "Bob", color: "#0000ff" },
          lastUpdated: Date.now(),
        },
      });
      awareness = applyRemoteState({
        awareness,
        clientId: "C",
        state: {
          cursor: { anchor: 10, head: 15 },
          user: { name: "Charlie", color: "#00ff00" },
          lastUpdated: Date.now(),
        },
      });

      const states = getStates({ awareness });
      expect(states.size).toBe(3);
    });
  });

  describe("optional cursor", () => {
    it("allows AwarenessState without cursor", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        user: { name: "Alice", color: "#ff0000" },
      });

      const states = getStates({ awareness });
      const state = states.get("A")!;
      expect(state.cursor).toBeUndefined();
      expect(state.user.name).toBe("Alice");
    });

    it("round-trips state without cursor through encode/decode", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        user: { name: "Alice", color: "#ff0000" },
      });

      const encoded = encodeAwareness({ awareness, clientId: "A" });
      const decoded = decodeAwareness({ data: encoded });

      expect(decoded.clientId).toBe("A");
      expect(decoded.state.cursor).toBeUndefined();
      expect(decoded.state.user.name).toBe("Alice");
    });
  });

  describe("viewingDocId", () => {
    it("stores viewingDocId in awareness state", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        viewingDocId: "card-123",
        user: { name: "Alice", color: "#ff0000" },
      });

      const states = getStates({ awareness });
      expect(states.get("A")!.viewingDocId).toBe("card-123");
    });

    it("round-trips viewingDocId through encode/decode", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = setLocalState({
        awareness,
        viewingDocId: "card-456",
        user: { name: "Alice", color: "#ff0000" },
      });

      const encoded = encodeAwareness({ awareness, clientId: "A" });
      const decoded = decodeAwareness({ data: encoded });

      expect(decoded.state.viewingDocId).toBe("card-456");
    });

    it("supports remote state with viewingDocId and no cursor", () => {
      let awareness = createAwareness({ clientId: "A" });
      awareness = applyRemoteState({
        awareness,
        clientId: "B",
        state: {
          viewingDocId: "card-789",
          user: { name: "Bob", color: "#0000ff" },
          lastUpdated: Date.now(),
        },
      });

      const states = getStates({ awareness });
      const state = states.get("B")!;
      expect(state.viewingDocId).toBe("card-789");
      expect(state.cursor).toBeUndefined();
    });
  });
});
