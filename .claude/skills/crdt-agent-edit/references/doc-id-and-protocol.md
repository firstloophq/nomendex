# Doc ID And Protocol Notes

## Workspace-Scoped Doc IDs

Nomendex collaborative documents use:

`ws:{scopeId}:{namespace}:{resourceId}`

- `scopeId`: `orgWorkspaceId` when present, otherwise local `workspace.id`
- `namespace`:
  - `note` for note documents
  - `kanban` for board documents
  - `card` for todo card documents
- `resourceId`: URL-encoded resource key

Project key mapping for `kanban`:

- `null` project filter -> `__all__`
- empty project string -> `__none__`
- normal project name -> unchanged

## WebSocket Endpoint

- Local sidecar: `ws://localhost:<port>/ws/crdt`
- Query params:
  - `clientId`: logical client id
  - `token`: optional auth token (needed for relay/team backend behavior)

## Wire Messages

Client -> server:

- `{ "type": "subscribe", "docId": "...", "stateVector": "{...}" }`
- `{ "type": "unsubscribe", "docId": "..." }`
- `{ "type": "ops", "docId": "...", "ops": [...] }`

Server -> client:

- `{ "type": "sync-response", "docId": "...", "ops": [...], "snapshot": "<base64?>" }`
- `{ "type": "ops", "docId": "...", "ops": [...] }`

`snapshot` is a base64-encoded `CRDTRecord` snapshot.

## Edit Constraints

- Content-addressed `replace` requires exactly one match for `oldString`.
- Anchor-based `insert` requires a unique anchor match when anchor is provided.
- `set-field` writes LWW scalar fields.
- `add-set`/`remove-set` mutate OR-Set fields (for example tags/columns).
- `move-card` writes board field `card:{cardId}` with JSON payload `{ column, order }` using fractional ordering.

## CRDT Module Resolution

The script loads CRDT logic in this order:

1. `NOMENDEX_CRDT_MODULE` (absolute file path)
2. `/Users/jacobcolling/crdt/src/crdt/index.ts`
3. `/Users/jacobcolling/nomendex/crdt/src/crdt/index.ts`
4. `../../../../crdt/src/crdt/index.ts` (relative fallback)
5. package import `@crdt/lib`
