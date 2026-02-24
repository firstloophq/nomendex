# AGENTS.md

## Current Focus

We are actively working on the CRDT-ification of the app.
The immediate priority is to make the rich text editor work reliably.

## Core Goal

Ensure markdown editing behavior and rendered structure stay in sync between two concurrent users.
All markdown formatting must sync properly.

## Test Environment Plan

Use a browser automation setup with two tabs open to the same note/document.

- Tab A and Tab B must use different user identities.
- User identities are set via query parameters (for example: `?userId=user-a` and `?userId=user-b`).
- Automation should send key events to the editor in each tab to mimic real typing behavior.
- Each scenario must end with screenshots of both editor tabs for visual verification.

## Test Workflow

For every test scenario:

1. Open both tabs with distinct `userId` values.
2. Focus editor in Tab A, send key events, and wait for sync.
3. Verify Tab B matches expected output.
4. Repeat from Tab B to Tab A.
5. Capture screenshots of both tabs.
6. Record pass/fail and mismatch details.

## How To Run Tests (Overall)

Use the user-testing runbook as the source of truth:

- Index / execution guide: `/Users/jacobcolling/nomendex/tests/user-testing/readme.md`
- Individual test cases: `/Users/jacobcolling/nomendex/tests/user-testing/*.md`

Execution order:

1. Read `/Users/jacobcolling/nomendex/tests/user-testing/readme.md` first.
2. Pick the next test file from `/Users/jacobcolling/nomendex/tests/user-testing/` (for example: `1-numbered-lists.md`).
3. Run the scenario in interactive headed Playwright controlled directly from this Codex session (not a shell batch runner).
4. Use two tabs on `/collab-test` with distinct identities.
5. Type one key per keystroke (no bulk typing calls) to mimic real human behavior.
6. Capture screenshots for both tabs and report `PASS`/`FAIL`.
7. If behavior appears to require CRDT library changes, document it in `/Users/jacobcolling/nomendex/issues/crdt/`.

## Test Runner Policy

- Do not use a batch test runner for these user-testing scenarios.
- Do not run all user tests with a single `playwright test` command.
- Always execute scenarios manually, one at a time, in a visible browser session.

## Proactive Regression Workflow

When a bug is reproduced with high confidence:

1. Immediately add or update an automated regression test for the exact repro path.
2. Implement the fix in the same work cycle.
3. Run the relevant test suite(s) and build/type/lint checks before reporting completion.
4. Record outcome and artifacts (logs/screenshots/report) in the CRDT Playwright artifacts area.

## Initial Scenario Coverage

At minimum, cover:

- plain paragraph typing
- bullet list creation via `- `
- numbered list creation via `1. `
- nested list indentation and outdent
- headings
- bold/italic/code formatting
- blockquote
- links/wiki links
- todo checkbox patterns used by this app
- mixed content edits (insert/delete in the middle of formatted blocks)

## Validation Standard

A scenario passes only when:

- both tabs show equivalent editor structure and text content
- no runtime editor errors occur
- no CRDT apply errors occur
- screenshots confirm visual parity for the tested case

## Error Handling Policy (Fail Fast)

For CRDT/editor/sync code paths, never silently recover from invalid state.

- Do not swallow exceptions in sync/bootstrap/apply paths.
- Throw explicit errors with doc identifiers and operation context.
- Log the failure with structured fields before throwing.
- Do not "fallback and continue" when document validity checks fail.
- Treat invalid ProseMirror document shape and CRDT invariant violations as fatal.
- If temporary handling is required during debugging, mark it clearly as temporary and open a follow-up issue in `/Users/jacobcolling/nomendex/issues/crdt/`.

## Debug and Artifacts

- Keep CRDT debug logging enabled by default.
- Save scenario results with:
  - scenario name
  - key sequence used
  - pass/fail result
  - screenshot references
  - relevant log excerpts when failures occur

## Extra Folder Access

Add additional folders as needed for this effort so they can be inspected and used during debugging:

- `/Users/jacobcolling/crdt`
