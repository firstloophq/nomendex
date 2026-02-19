# CRDT Playwright Collab Test Setup

Date: 2026-02-19

## Goal

Run repeatable two-tab editor sync checks with deterministic identities, keyboard-driven typing, and screenshot verification.

## URL pattern

Use these URLs for automation sessions:

- `http://localhost:1234/?userId=user-a&forceCollab=1`
- `http://localhost:1234/?userId=user-b&forceCollab=1`

Dedicated isolated page (recommended):

- `http://localhost:1234/collab-test?doc=smoke&userId=user-a`
- `http://localhost:1234/collab-test?doc=smoke&userId=user-b`

## Query params

- `userId`: sets deterministic test identity (`user-a`/`user-b`)
- `forceCollab=1`: enables collab provider for automation sessions even when Clerk is not signed in
- optional: `crdtClientId=<id>` to explicitly set a client id
- `doc`: document key used by `/collab-test` to map to `collab-test/<doc>.md`

## `/collab-test` behavior

- No Clerk/Teams login required.
- Uses route-based collab enablement by default.
- Loads and persists a shared markdown note (`collab-test/<doc>.md`) so content survives server restarts.
- Includes a `Clear all` button that clears the live ProseMirror document and propagates through CRDT to all open tabs.

## Test Automation Harness

Implemented in `bun-sidecar/tests/crdt-collab.spec.ts`.

- Uses two pages in one browser context with unique `userId` parameters (`user-a` and `user-b`).
- Sets `localStorage` `nomendex:crdt-debug=1` on test context startup.
- Resets workspace + test note before each direction check.
- Sends key sequences with `keyboard.type` / `keyboard.press`.
- Captures sync state from both editors and compares text/structure.
- Captures screenshots for both tabs after each scenario direction.
- Writes structured results to `docs/specs/team/issues/artifacts/crdt-playwright/crdt-collab-scenarios.json`.

## Scenarios covered

- plain paragraph typing
- bullet list creation via `- `
- numbered list creation via `1. `
- nested list indentation and outdent
- headings
- heading level 2 marker (`## `)
- heading level 1 marker (`# `)
- heading level 3 marker (`### `)
- bold/italic/code formatting
- blockquote
- blockquote marker conversion (`> `)
- links and wiki links
- todo patterns
- list indentation command (`Tab`)
- list outdent command (`Shift+Tab`)
- numbered list marker conversion (`1. `, `2. `)
- mixed insert/delete edits

See `docs/specs/team/issues/artifacts/crdt-playwright/markdown-behavior-map.md` for the full behavior matrix and command coverage.

## Running

From `bun-sidecar`:

1. Ensure app is running on port 1234.
2. Install browsers (first run):
   `bun run test:crdt:e2e:install`
3. Run the suite:
   `bun run test:crdt:e2e`
