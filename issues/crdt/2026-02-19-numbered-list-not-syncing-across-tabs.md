# CRDT Issue: Numbered List Does Not Sync Across Tabs

- Date: 2026-02-19
- Test file: `/Users/jacobcolling/nomendex/tests/user-testing/1-numbered-lists.md`
- Doc ID: `user-testing-1-numbered-lists`

## Repro Steps

1. Open two tabs:
- `http://localhost:1234/collab-test?doc=user-testing-1-numbered-lists&userId=user-a`
- `http://localhost:1234/collab-test?doc=user-testing-1-numbered-lists&userId=user-b`
2. Click `Clear all` and refresh each tab.
3. In active tab (`user-a`), type numbered list:
- `1. First item`
- `Enter`
- `Second item`
- `Enter`
4. Compare editor output in both tabs.

## Expected Behavior

Both tabs show equivalent numbered list structure and text content after sync.

## Actual Behavior

- Tab A editor text: `First item` + `Second item` (numbered list)
- Tab B editor text: empty (`"\n"`)
- Content did not propagate to second tab.

## Why This Appears CRDT-Side

- Both tabs are open on same `doc` id and collab route.
- Local edits apply in source editor but remote tab remains empty.
- This indicates missing or failed remote op propagation/apply for this scenario.

## Artifacts

- Tab B screenshot: `.playwright-cli/page-2026-02-19T18-02-02-994Z.png`
- Tab A screenshot: `.playwright-cli/page-2026-02-19T18-02-06-108Z.png`

## What CRDT Library Needs To Solve

Ensure local numbered-list edits are emitted, transported, and applied remotely so both editor states converge for the same shared doc across concurrent tabs.
