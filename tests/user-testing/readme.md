# User Testing Runbook (Playwright, Headed)

Goal: make manual/visible collaborative editor testing fast and repeatable.

## Core Rules

- Use Playwright in headed mode (visible browser).
- Codex controls the browser interactions.
- Type one key per keystroke for all text entry (no bulk `type(\"full sentence\")` calls).
- Every test must end with:
  - screenshots from both tabs
  - explicit `PASS` or `FAIL`
  - short failure reason (if failed)

## Prerequisites

1. Start app server:
```bash
cd /Users/jacobcolling/nomendex/bun-sidecar
bun run dev
```
2. Use the interactive Playwright controls in this Codex session.
3. Keep the browser visible (headed).

## Runner Policy

- Do not use a batch runner for user-testing scenarios.
- Do not run a single command to execute all tests.
- Run exactly one scenario at a time, then record pass/fail before starting the next.
- Stop at the first `FAIL` and debug/fix before proceeding to later scenarios.

## How To Run A Test File

For each test file in `/Users/jacobcolling/nomendex/tests/user-testing`:

1. Read the test prompt steps from the file.
2. Assign the next numeric doc id (`doc=1`, then `doc=2`, then `doc=3`, ...).
3. Always increment doc id for every new attempt, including reruns after failures. Never reuse a previous doc id.
4. Open two tabs on `/collab-test` with same `doc`, different `userId`, and different `crdtClientId`.
5. Perform steps exactly as written.
6. Enter text as true keystrokes, one key at a time, including punctuation and spaces.
7. Take screenshots of both tabs.
8. Compare visible editor output.
9. Declare result:
- `PASS`: both editors show equivalent content/structure.
- `FAIL`: mismatch, runtime issue, or sync issue.

## Keystroke Fidelity (Required)

- All typing must be executed as one key per action to mimic human behavior.
- This is especially required for markdown/input-rule paths (`- `, `1. `, `# `, `> `, etc.).
- Do not batch full words/sentences into a single type call.
- Enter, Tab, Shift+Tab, arrows, backspace/delete must be sent as explicit key presses.
- Add a small delay between keystrokes (recommended: 75-120ms) to better mimic real user input timing.
- Use normal browser keyboard events only (`page.keyboard.press(...)` per key); no synthetic direct document mutation.

## Standard URL Pattern

- Tab A: `http://localhost:1234/collab-test?doc=<doc-id>&userId=user-a&crdtClientId=<doc-id>-a`
- Tab B: `http://localhost:1234/collab-test?doc=<doc-id>&userId=user-b&crdtClientId=<doc-id>-b`

Keep `<doc-id>` the same for both tabs in one scenario.
Increment `<doc-id>` for every scenario run and rerun (`1`, `2`, `3`, ...), with no reuse.

## Required Result Output (per test)

Use this exact format after each run:

```text
Test: <file name>
Result: PASS | FAIL
Doc ID: <doc-id>
Screenshots:
- Tab A: <path>
- Tab B: <path>
Notes: <mismatch details or "none">
```

## Failure Handling

If a test fails:

1. Stop and report failure immediately.
2. Include what diverged (content/structure/focus/errors).
3. Include screenshot paths.
4. Do not mark complete until user acknowledges.

## CRDT Library Issues

If a failure appears to require a CRDT library fix (not app-only wiring/UI):

1. Create a new issue note under `/Users/jacobcolling/nomendex/issues/crdt/`.
2. Name it with a short slug, for example: `2026-02-19-heading-sync-parity.md`.
3. Document:
- test file/scenario
- exact repro steps
- expected behavior
- actual behavior
- why this points to CRDT library behavior
- screenshot/log references
- clear statement of what the CRDT library needs to solve
4. Mark the test run as `FAIL` until the CRDT-side behavior is resolved.

## Priority

Primary priority is easy, reliable validation of each editor behavior.
If a test is hard to run, simplify the procedure and update the test file so future runs are easier.
