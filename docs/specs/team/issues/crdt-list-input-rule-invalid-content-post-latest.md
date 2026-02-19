# CRDT Follow-up: List Input Rule + Invalid PM Content After Refresh

- Date: 2026-02-19
- App branch: `jake/nomendex-team-homemadecrdt`
- Linked CRDT lib: local `@crdt/lib` (`file:../../crdt`)

## Verified baseline

We confirmed the latest CRDT patch set is present in the app workspace:
- Shared bootstrap placeholder ID in `plugin.ts` (`SHARED_INITIAL_BLOCK_ID`)
- Tree-aware PM position mapping in `state-mapping.ts`
- Transaction range capture using `getItemsInProseMirrorRange` in `transaction-capture.ts`
- New list-fidelity tests exist and are present locally

## Current user-visible issue

After that patch set, sync is much better, but we still see intermittent list behavior issues when typing markdown list triggers, especially `- `:
- Sometimes the bullet/list structure does not form as expected.
- After refresh, editor can crash with:
  - `Called contentMatchAt on a node with invalid content`

This points to a transient invalid PM tree getting reconstructed/applied at some point in the sequence.

## App-side hardening added (to stabilize + improve debugging)

In `bun-sidecar/src/features/notes/note-view.tsx`:
- Added robust step diagnostics in `pm_dispatch` logs:
  - now logs `toJSON().stepType`, `jsonID`, constructor name, `from/to`, `gapFrom/gapTo`, and slice presence.
- Wrapped remote apply path in try/catch around `applyRemoteOps(...)`.
- Added post-apply `result.state.doc.check()` validation before `updateState`.
- If invalid, app now logs and skips applying that bad update instead of hard-crashing.
- Added window-level error/rejection capture (debug mode) with current PM doc shape.

New debug events:
- `CRDT:remote_ops_invalid_doc`
- `CRDT:remote_ops_apply_failed`
- `CRDT:runtime_error`
- `CRDT:runtime_unhandled_rejection`

## Ask for CRDT team

Please review whether list/input-rule generated step sequences (notably wrap/lift around list transforms) can still produce structurally invalid block-parent relationships under concurrency or replay.

Specifically, we need confirmation around this path:
- local `- ` trigger / list transform
- remote replay/apply
- refresh/re-hydration

If useful, we can provide fresh logs with the new step details and doc-shape snapshots from the events above.
