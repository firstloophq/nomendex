# Issue: CRDT Notes Sync Fails Because No Local Ops Are Captured

- Date: 2026-02-19
- Branch: `jake/nomendex-team-homemadecrdt`
- Area: `bun-sidecar` + `@crdt/lib` ProseMirror integration
- Severity: High (real-time note sync is effectively disabled)

## Summary
In team mode, typing in the notes editor produces ProseMirror transactions and awareness updates, but **no CRDT document ops are ever captured/sent**. That means collaborators see presence/cursors but document content diverges and does not sync correctly.

## Expected
Typing in one tab should produce CRDT ops (`local_ops_captured` -> `send_ops`) and remote tabs should receive/apply them (`transport_on_ops` / `remote_ops_received`).

## Actual
- `editor_keydown` events are emitted
- `pm_dispatch` with `docChanged=true` is emitted
- `send_awareness` / `transport_on_awareness` is emitted
- **No** `local_ops_captured`
- **No** `send_ops`
- **No** `transport_on_ops` / `remote_ops_received`

## Reproduction
1. Enable CRDT debug in both tabs:
   - `localStorage.setItem("nomendex:crdt-debug", "1"); location.reload();`
2. Open same note in two team-mode tabs.
3. Type in one tab (`aasdfasdf`, Enter, etc.).
4. Observe: cursor/presence updates, but text sync is incorrect/divergent.

## Evidence
Captured from `GET /api/logs/recent?limit=1800&contains=CRDT:`.

### Session counts (key session)
Session `dbg-1771471092963-tmf05e`:
- `CRDT:editor_keydown`: 18
- `CRDT:pm_dispatch`: 19
- `CRDT:send_awareness`: 17
- `CRDT:local_ops_captured`: 0
- `CRDT:send_ops`: 0
- `CRDT:transport_on_ops`: 0
- `CRDT:remote_ops_received`: 0

### Timeline sample
- `2026-02-19T03:18:16.393Z` `CRDT:editor_keydown` key=`a`
- `2026-02-19T03:18:16.396Z` `CRDT:pm_dispatch` `docChanged=true` `steps=ReplaceStep4`
- (repeats for each key)
- No corresponding `local_ops_captured` or `send_ops` at any point.

## Most Likely Root Cause
`@crdt/lib` transaction capture currently relies on `instanceof` checks for PM step classes (`ReplaceStep`, `AddMarkStep`, etc.) in:

- `src/crdt/prosemirror/transaction-capture.ts`

Because nomendex and the linked `@crdt/lib` can resolve different physical copies of `prosemirror-transform`, runtime `instanceof` can fail even when step names match. When that happens, step handlers are skipped and `transactionToCRDTOps()` returns an empty op list.

This exactly matches observed behavior: PM transactions occur, but local CRDT ops are never produced.

## Proposed Fix
### Preferred (library fix)
In `@crdt/lib` `transaction-capture.ts`, add fallback step discrimination that does not depend solely on `instanceof`, e.g.:
- `constructor.name` / `jsonID` checks, and
- shape checks for step fields (`from`, `to`, `slice`, `gapFrom`, `mark`, etc.)

Then route to existing handlers (`handleReplaceStep`, `handleAddMarkStep`, etc.) when fallback matches.

### Structural follow-up
Make ProseMirror packages peer dependencies (or otherwise enforce singleton resolution) so both app and library use the same runtime classes.

## Acceptance Criteria
1. In collab mode typing emits `CRDT:local_ops_captured` and `CRDT:send_ops` for doc changes.
2. Remote tab logs `CRDT:transport_on_ops` + `CRDT:remote_ops_received` + `CRDT:remote_ops_applied`.
3. Two-tab test with paragraphs + list items remains in sync without drift.
4. Presence-only symptoms (cursor but no content sync) are gone.

## Related Instrumentation
Added debugging/logging hooks to:
- `bun-sidecar/src/lib/crdt-debug.ts`
- `bun-sidecar/src/features/notes/note-view.tsx`
- `bun-sidecar/src/contexts/CollabContext.tsx`
- `bun-sidecar/src/server-routes/logs-routes.ts` (`GET /api/logs/recent`)

