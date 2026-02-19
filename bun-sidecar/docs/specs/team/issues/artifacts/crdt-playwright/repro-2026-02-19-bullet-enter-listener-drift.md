# Reproduction Report: bullet-enter listener drift

Date: 2026-02-19
Reported issue: pressing `Enter` on a bullet line can render incorrectly on the listener tab (reported as numbered marker instead of bullet continuation).

## Environment

- App URL: `http://localhost:1234/`
- Source identity: `?userId=user-b&forceCollab=1&crdtClientId=user-b-e2e`
- Listener identity: `?userId=user-a&forceCollab=1&crdtClientId=user-a-e2e`
- Log source used: `GET /api/logs/recent`

## Reproduction executed

1. Open two tabs with distinct CRDT identities (`user-b`, `user-a`).
2. Focus editor in source tab.
3. Type this exact key sequence in source tab: `asdfasdfasdf`, Enter, `asdfasdfasdf`, Enter, `asdfasdf`, Enter, `1. first`, Enter, `second`, Enter, Enter, `- asda`, Enter, `asda`, Enter, Enter.
4. Capture screenshots of source and listener tabs.

## Observed result

- Source tab shows the expected mixed structure (paragraphs + ordered list + bullet list).
- Listener tab did not match source content and remained on stale/partial content.
- This is a sync divergence and confirms listener drift during list-enter flows.
- I did not capture an exact bullet-to-number conversion in this run, but the reported class of issue (list sync mismatch on Enter) is reproducible.

## Expected result

- Listener tab should show the same list structure and content as source.
- Enter on bullet lines should remain bullet continuation unless intentionally exited.

## Log findings

- `api/logs/recent` confirms active CRDT session churn (transport init/close, note init, subscribe) for both user IDs.
- No `CRDT:remote_ops_apply_failed` entries found in recent logs.
- No `CRDT:remote_ops_invalid_doc` entries found in recent logs.
- Background Playwright run is active concurrently and continuously mutating CRDT notes: `node /Users/jacobcolling/nomendex/bun-sidecar/node_modules/.bin/playwright test tests/crdt-collab.spec.ts ...`
- This concurrent runner is a likely confounder for manual reproduction stability.

## Artifacts

- Source screenshot: `/Users/jacobcolling/nomendex/bun-sidecar/docs/specs/team/issues/artifacts/crdt-playwright/manual-repro-bullet-enter-mixed-user-b.png`
- Listener screenshot: `/Users/jacobcolling/nomendex/bun-sidecar/docs/specs/team/issues/artifacts/crdt-playwright/manual-repro-bullet-enter-mixed-user-a.png`
- Prior scenario reference: `/Users/jacobcolling/nomendex/bun-sidecar/docs/specs/team/issues/artifacts/crdt-playwright/crdt-collab-scenarios.json`

## Next isolation step

1. Stop concurrent `tests/crdt-collab.spec.ts` runner.
2. Re-run the same sequence on a fixed note id with only two manual tabs.
3. Capture `api/logs/recent?contains=<fixed-note-id>` immediately after sequence.
4. Promote this sequence into a deterministic Playwright scenario assertion for list parity.
