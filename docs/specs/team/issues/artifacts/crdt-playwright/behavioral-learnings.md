# CRDT Playwright Behavioral Learnings

Date: 2026-02-19

## Current Findings

- Heading marker workflows (`# `) can trigger tag-link suggestion range state near block starts; range validation has been added to avoid invalid decoration ranges during transitions.
- Decorated plugin state in the editor is now guarded through defensive update recovery to prevent whole-view crashes when `EditorView.updateState` fails.
- Existing heading path tests were split into marker + space key steps to more closely mirror realistic typing and avoid transient trigger artifacts.

## Scenario Log (Template)

Each scenario should append a short entry after validation runs:

- `plain-paragraph`: status = pass/fail, notes
- `bullet-list`: status = pass/fail, notes
- `bullet-inputrule-marker`: status = pass/fail, notes
- `numbered-list`: status = pass/fail, notes
- `numbered-list-inputrule-marker`: status = pass/fail, notes
- `nested-list`: status = pass/fail, notes
- `nested-list-command-indent`: status = pass/fail, notes
- `nested-list-command-outdent`: status = pass/fail, notes
- `heading-inputrule-marker`: status = pass/fail, notes
- `heading-level-2-marker`: status = pass/fail, notes
- `heading-level-3-marker`: status = pass/fail, notes
- `headings`: status = pass/fail, notes
- `blockquote-inputrule-marker`: status = pass/fail, notes
- `blockquote`: status = pass/fail, notes
- `formatting`: status = pass/fail, notes
- `links-wikilinks`: status = pass/fail, notes
- `todo-patterns`: status = pass/fail, notes
- `mixed-edits`: status = pass/fail, notes
