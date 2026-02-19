# CRDT Markdown Behavior Map (Editor Collab)

Date: 2026-02-19

## Goal

Validate that markdown typing behavior and markdown-like commands stay structurally identical across two collaborative clients during CRDT sync.

## Test Harness

- Commanded via two tabs in `bun-sidecar/tests/crdt-collab.spec.ts`
- Deterministic users:
  - `user-a` and `user-b`
  - `?forceCollab=1&crdtClientId=...`
- Assertions are done after each action pair by:
  - editor text structure snapshot
  - DOM node tag checks (`h1`, `ul`, `ol`, `blockquote`, etc.)
  - screenshot capture for both clients

## Markdown Behavior + Command Matrix

| ID | Markdown behavior / command | Input sequence to exercise | Expected markers | Test coverage file |
| --- | --- | --- | --- | --- |
| `plain-paragraph` | Plain typing and paragraph sync | `The quick brown fox ...` | `<p>` with full text | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `bullet-list` | Bullet list typing (explicit `-`) | `- Bullet one`, `Enter`, `- Bullet two` | `<ul><li>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `bullet-inputrule-marker` | Bullet marker input rule (`- `) | `-` + `Space` | `<ul>`, `<li>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `numbered-list-inputrule-marker` | Numbered list marker input rule (`1. `, `2. `) | `1`, `.`, `Space`, text, `Enter`, `2`, `.`, `Space`, text | `<ol><li>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `numbered-list` | Numbered list typing (`1. `, `2. `) | `1. ...`, `Enter`, `2. ...` | `<ol><li>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `nested-list` | Nested list structure from explicit indent syntax | `- Parent`, `Enter`, `  - Child` | `<ul>` with nested `<ul>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `nested-list-command-indent` | List indentation command path | `- Parent`, `Enter`, `- Child`, `Tab`, `Enter`, `- Grandchild` | `<ul>` nesting preserved after command | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `nested-list-command-outdent` | List outdent command path | `- Parent`, `Enter`, `- Child`, `Tab`, `Shift+Tab`, `Enter`, `- Back to parent` | `<ul>` with explicit outdent transition | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `heading-hash-focus-retained` | Focus stability on heading marker | `#` | editor remains focused after marker key | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `heading-inputrule-marker` | Heading level 1 input rule (`# `) | `# ` + `header` | `<h1>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `heading-level-2-marker` | Heading level 2 input rule (`## `) | `## ` + `subheader` | `<h2>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `heading-level-3-marker` | Heading level 3 input rule (`### `) | `### ` + `section` | `<h3>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `headings` | Mixed heading block sequence | `# ...`, `Enter`, `Some intro`, `Enter`, `## ...` | `<h1>` and `<h2>` order preserved | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `formatting` | Bold / italic / inline code syntax | `**bold**`, `*italic*`, `` `code` `` | `<strong>`, `<em>`, `<code>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `blockquote` | Blockquote input rule and content | `> Quote line one` | `<blockquote>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `blockquote-inputrule-marker` | Blockquote marker path (`> `) | `> ` + `quote line one` | `<blockquote>` | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `links-wikilinks` | Markdown link + wiki-link tokenization | `See [[wiki-note]] ... [External](...)` | `<a>` + wiki link class marker | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `todo-patterns` | Todo checkbox patterns | `- [ ] ...`, `- [x] ...` | checkbox decoration metadata and todo text | `bun-sidecar/tests/crdt-collab.spec.ts` |
| `mixed-edits` | In-place edits in formatted block context | heading + body + selection edits | heading node + formatting-preserving text edits | `bun-sidecar/tests/crdt-collab.spec.ts` |

## Commands to keep in sync

- Enter / paragraph break
- Tab (indent list item)
- Shift+Tab (outdent list item)
- Home / Arrow key movement during mutation
- Clipboard-like deletion (Backspace) while markdown structure exists
- Numbered list marker input sequence (`1`, `.`, `Space`, ...), including repeated list item sequences
- Heading marker single-key focus retention (`#` should not blur the editor)
- Sync from A→B and B→A for each scenario

## TDD loop targets

1. Add/maintain a scenario in `crdt-collab.spec.ts`.
2. Run `bun test:crdt:e2e` or equivalent locally.
3. Verify:
   - scenario passes in both directions
   - screenshots for both tabs are visually identical in structure
   - no runtime/CRDT errors in app logs
4. Record outcome in `docs/specs/team/issues/artifacts/crdt-playwright/crdt-collab-scenarios.json`.
