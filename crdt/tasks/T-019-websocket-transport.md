---
id: T-019
title: "WebSocket transport for CRDT sync"
status: done
priority: high
tags: [network, server, websocket]
depends_on: [T-009, T-010, T-014]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Add a WebSocket endpoint to the Bun server and a client-side transport module. The server relays CRDT operations between connected editors. Each client sends local ops and receives remote ops via WebSocket.

## Acceptance Criteria
- [x] Server has a `/ws` WebSocket endpoint
- [x] Server broadcasts incoming ops to all other connected clients
- [x] Client transport sends serialized ops to the server
- [x] Client transport receives and deserializes remote ops
- [x] Server handles connect/disconnect gracefully

## Test Plan
- Unit test: encode/decode operations over the wire
- Integration: two clients connect, one sends ops, other receives them

## Implementation Notes
Server: `src/index.ts` — Bun `serve()` with `fetch` upgrade handler for `/ws?clientId=...` and `websocket` handlers. Broadcasts incoming messages to all other connected clients. Tracks clients in a `Set<ServerWebSocket>`.

Client: `src/crdt/network/transport.ts` — `createWebSocketTransport()` opens WebSocket, sends JSON-serialized ops, and invokes `onRemoteOps` callback on received messages.
