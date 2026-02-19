# Issue: Bullet Input Divergence In Two-Tab Forced Collab Run

Date: 2026-02-19

## Environment

- App URL A: `http://localhost:1234/?userId=user-a&forceCollab=1`
- App URL B: `http://localhost:1234/?userId=user-b&forceCollab=1`
- Collab mode: forced on (`forceCollab=1`) with deterministic client IDs

## Reproduction

1. Open both URLs in separate tabs.
2. In tab B (`user-b`), focus editor and type:
   - `Enter`
   - `- `
   - `BULLETB1771474139762`
3. Wait for sync to tab A.
4. Compare structure and rendering.

## Observed

Tab B (source):

- Bullet renders as list item (`li` present).
- Marker appears as bullet item.

Tab A (remote):

- Marker text syncs, but list structure does not.
- Content appears as plain text line beginning with `-`.
- DOM check showed `liCount: 0` and `markerInLi: 0` on tab A.

## Evidence

- `docs/specs/team/issues/artifacts/crdt-tab-a-bullet-divergence.png`
- `docs/specs/team/issues/artifacts/crdt-tab-b-bullet-divergence.png`

## Notes

- Plain text sync succeeded in this same forced-collab run.
- Divergence appears specifically at markdown input-rule list transformation boundary.
