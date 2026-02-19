# Playwright User Testing Prompts

Use these prompts when you want headed, visible browser automation (not test specs).

## 1) Open two synced collab tabs
Prompt:
`Use the Playwright skill in headed mode. Open /collab-test in two tabs with the same doc and users user-a/user-b so I can watch sync happen live.`

Expected URL pattern:
- `http://localhost:1234/collab-test?doc=<doc-id>&userId=user-a`
- `http://localhost:1234/collab-test?doc=<doc-id>&userId=user-b`

## 2) Type in A, verify in B
Prompt:
`Using Playwright skill headed mode, type markdown in tab A and verify tab B matches before moving on.`

Use for:
- paragraph typing
- list markers (`- `, `1. `)
- headings (`# `, `## `)
- formatting (`**bold**`, `*italic*`, `` `code` ``)

## 3) Reverse direction (B to A)
Prompt:
`Now do the same sequence from tab B and verify tab A receives the exact structure.`

Use for:
- confirming bidirectional sync
- catching asymmetric input-rule bugs

## 4) Clear all propagation
Prompt:
`In headed Playwright mode, click Clear all in one tab and verify both tabs are empty.`

Use for:
- CRDT propagation validation
- reset between manual scenarios

## 5) Capture screenshots after each scenario
Prompt:
`After this scenario, take screenshots of both tabs and label them with scenario name and direction.`

Use for:
- visual parity evidence
- debugging diffs

## 6) Focus and editor-stability checks
Prompt:
`Run this in headed mode and confirm editor focus is retained while typing markdown markers; pause if focus is lost.`

Use for:
- `#`, `> `, wiki-link trigger stability
- regressions around input rules

## 7) Full manual run (A->B and B->A)
Prompt:
`Run a full manual Playwright headed session for this doc with both directions, include sync checks and screenshots for each scenario.`

Recommended scenario list:
- plain paragraph
- bullet list
- numbered list
- nested indent/outdent
- headings
- bold/italic/code
- blockquote
- links/wiki links
- todo checkbox patterns
- mixed insert/delete in formatted content

## 8) Debug with logs while visible
Prompt:
`Use headed Playwright flow and correlate on-screen behavior with recent CRDT logs when a mismatch happens.`

Use for:
- narrowing transport vs editor-state issues
- attaching reproducible artifacts

## Operator Notes

- Prefer Playwright skill CLI flow (`$PWCLI`) with `--headed`.
- Prefer interactive commands (`open`, `tab-new`, `snapshot`, `click`, `type`, `screenshot`) over test-spec execution.
- Keep `nomendex:crdt-debug` enabled.
- Reuse one `doc` ID per scenario pair; change `doc` between independent runs.
