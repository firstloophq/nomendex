---
id: T-010
title: "Binary update encoding/decoding"
status: done
priority: medium
tags: [crdt, network, encoding]
depends_on: [T-004]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Efficient binary encoding for operations and sync messages. While JSON works for development, a compact binary format reduces bandwidth for production use. This can use a simple custom format or leverage existing tools like protocol buffers.

Start with JSON encoding and add binary encoding as an optimization.

## Acceptance Criteria
- [x] `encodeOperations(ops)` → `Uint8Array`
- [x] `decodeOperations(bytes)` → `Operation[]`
- [x] JSON encoding/decoding as baseline
- [x] Round-trip: encode → decode produces identical operations
- [x] Handles all operation types (insert, delete, format)

## Test Plan
- Encode and decode each operation type
- Encode a batch of 100 mixed operations, decode, verify equality
- Empty operation list encodes/decodes correctly
- Invalid bytes throw a descriptive error

## Implementation Notes
Implemented at `src/crdt/network/encoding.ts`. JSON-based encoding using TextEncoder/TextDecoder to Uint8Array. 8 tests passing.
