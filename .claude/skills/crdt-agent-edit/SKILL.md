---
name: crdt-agent-edit
description: Read and edit Nomendex multiplayer CRDT documents (notes, kanban boards, and card docs) through the /ws/crdt API. Use when an agent must apply collaborative text changes directly by CRDT docId and keep updates synchronized across connected clients.
---

# CRDT Agent Edit

Use this skill when file-only APIs are not enough and a task must update the live collaborative CRDT state.

Use `scripts/crdt_doc_ws.ts` from `/Users/jacobcolling/nomendex`.

## Quick Start

```bash
# 1) Resolve active workspace scope id
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts active-scope

# 2) Build a note doc id
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts build-doc-id \
  --namespace note \
  --resource "daily.md"

# 3) Read current CRDT content
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts read \
  --doc-id "ws:<scope>:note:daily.md"

# 4) Replace text (always suggestion-marked)
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts replace \
  --doc-id "ws:<scope>:note:daily.md" \
  --old "old sentence" \
  --new "new sentence"

# 5) Insert text relative to an anchor string (always suggestion-marked)
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts insert \
  --doc-id "ws:<scope>:note:daily.md" \
  --content "Added line" \
  --anchor "Section header" \
  --position after

# 6) Update card metadata field (title/description/status/etc.)
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts set-field \
  --doc-id "ws:<scope>:card:<todo-id>" \
  --field title \
  --value "Updated title"

# 7) Add/remove set values (for tags/columns/etc.)
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts add-set \
  --doc-id "ws:<scope>:card:<todo-id>" \
  --field tags \
  --value urgent

bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts remove-set \
  --doc-id "ws:<scope>:card:<todo-id>" \
  --field tags \
  --value urgent

# 8) Move a card on a board
bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts move-card \
  --doc-id "ws:<scope>:kanban:__all__" \
  --card-id "<todo-id>" \
  --column "in_progress"
```

## Workflow

1. Resolve workspace scope with `active-scope` unless scope is already known.
2. Build a deterministic doc id using `build-doc-id`.
3. Read current CRDT state with `read` before mutating.
4. Apply narrow `replace`/`insert` operations so conflicts are minimized.
5. Re-read and verify final state (`read --format json`).

## Notes

- `replace` and `insert` always create suggestion-marked edits for review in the UI.
- `replace` requires a unique `--old` match in current document text.
- `insert --anchor` requires a unique anchor match when provided.
- Metadata commands (`set-field`, `add-set`, `remove-set`, `move-card`) operate directly on CRDT record fields/sets.
- Use `--dry-run` on `replace` and `insert` to preview without sending ops.
- Use `--dry-run` on metadata commands when you need to preview order/value results first.
- For team relay behavior, pass `--token` (or set `NOMENDEX_CRDT_TOKEN`) so `/ws/crdt` can relay to team backend when enabled.
- If CRDT module resolution fails, set `NOMENDEX_CRDT_MODULE` to an absolute path of `src/crdt/index.ts`.

## Reference

See `references/doc-id-and-protocol.md` for doc-id construction and WebSocket message format.
