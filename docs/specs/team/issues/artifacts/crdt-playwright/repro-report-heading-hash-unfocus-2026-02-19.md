# Reproduction Report: Editor Unfocus On `#` / ` #`

Date: 2026-02-19  
Environment: local dev (`bun run dev`), app URL `http://localhost:1234/`  
User params: `?userId=repro-focus-a&forceCollab=1&crdtClientId=repro-focus-a`

## Summary

Typing `#` or ` #` in the note editor causes focus to leave the editor immediately.  
After manually clicking back into the editor, pressing `Space` converts the marker into a heading as expected.

## Reproduction Steps

1. Open `http://localhost:1234/?userId=repro-focus-a&forceCollab=1&crdtClientId=repro-focus-a`.
2. Open a note in the Notes editor (used note: `repro-heading-focus-1771479148960.md`).
3. Click inside `.editor-content .ProseMirror`.
4. Clear content (`Meta+A`, `Backspace`).
5. Type `#` (or ` #`).
6. Observe focus state.
7. Click editor again and press `Space`.
8. Observe heading conversion.

## Expected

- Editor focus stays in `.ProseMirror` after typing `#` / ` #`.
- Typing `#` then `Space` should convert to heading inline without requiring refocus.

## Actual

- Focus moves from editor to `BODY` immediately after typing `#` / ` #`.
- Manual refocus + `Space` then correctly creates heading node.

## Probe Results

Automated focus probe (Playwright) ran 8 trials for each pattern:

- Pattern `#`: 8/8 trials unfocused the editor.
- Pattern ` #`: 8/8 trials unfocused the editor.
- Combined: 16/16 unfocus events.

Representative focus transition:

- Before typing: `DIV.ProseMirror.ProseMirror-focused` (`inEditor=true`)
- After typing `#`: `BODY` (`inEditor=false`)

Representative document state after refocus + `Space`:

- `innerHTML`: `<h1><br class="ProseMirror-trailingBreak"></h1>`

## Console / Runtime Errors

- Browser console errors during repro: `0`
- Warning observed: Clerk development keys warning (non-editor runtime issue).

## Artifacts

- Screenshot: `/Users/jacobcolling/nomendex/docs/specs/team/issues/artifacts/crdt-playwright/repro-hash-unfocus-2026-02-19.png`
- This report: `/Users/jacobcolling/nomendex/docs/specs/team/issues/artifacts/crdt-playwright/repro-report-heading-hash-unfocus-2026-02-19.md`

