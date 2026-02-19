# Team Todos Collaboration (CRDT + Presence)

This document describes the team-mode todo collaboration architecture for kanban boards, including CRDT sync, file persistence, and presence.

## Scope

- Applies only in **team workspaces** (`teamMode === "team"`).
- Solo mode continues to use the existing file-backed REST-style todo flow.
- v1 supports:
  - real-time board/card sync per project board
  - soft delete
  - presence for focused card + active editor state

## Entry Points

- `bun-sidecar/src/features/todos/useKanban.ts`
- `bun-sidecar/src/features/todos/browser-view.tsx`
- `bun-sidecar/src/features/todos/archived-view.tsx`
- `bun-sidecar/src/features/todos/TodoCard.tsx`
- `bun-sidecar/src/features/todos/TaskCardEditor.tsx`

## Mode Gating

Team collab path is activated when all are true:

1. Workspace is team mode.
2. Collab context is available.
3. Todos view passes `enabled: true` into `useKanban`.

When active, UI reads/writes through `useKanban`; otherwise it uses `useTodosAPI`.

## CRDT Data Model

### Board Record

- One board record per workspace + project key.
- Doc id format:
  - `ws:{orgWorkspaceId}:kanban:{projectKey}`
- Project key mapping:
  - `null` project filter -> `__all__`
  - empty project (`""`) -> `__none__`
  - named project -> that project name

Board record stores:
- column list / layout
- per-column card ordering (card ids)

### Card Records

- Each todo is a separate card record:
  - `ws:{orgWorkspaceId}:card:{todoId}`
- Raw todo ID is also stored in card fields (`todoId`) for file persistence calls and legacy fallback.
- Card fields store title, description, status, project, archived/deleted flags, tags, due date, attachments, timestamps.

## Bootstrap and Persistence Strategy

### Bootstrap from Existing Files

After board sync completes, `useKanban` loads file-backed todos (`active + archived`) and merges missing cards into CRDT state. This preserves existing markdown todo files when moving into team mode.

### Ongoing Persistence

Team-mode mutations are still persisted to file-backed APIs (for compatibility with single-player and existing storage):

- `createTodo`: persist file -> create CRDT card
- `updateTodo`: persist file -> update/move CRDT card
- `reorderTodos`: persist file order -> apply CRDT moves

Soft delete behavior in v1:
- delete marks todo as archived/deleted instead of hard removal.

## Presence Model

Presence uses CRDT awareness on the **board doc channel**.

### Sent by local client

`sendPresence({ todoId, editing })` sends:

- `viewingDocId = cardDocId` when a card is selected/open
- `cursor` set (sentinel) when a card editor is open (`editing = true`)
- `user` and `lastUpdated`

### Derived from remote clients

`useKanban` aggregates awareness into:

- `presenceByDoc: Map<todoId, UserInfo[]>` (focused/viewing)
- `editingByDoc: Map<todoId, UserInfo[]>` (actively editing)

`editingByDoc` is derived from awareness states that include `cursor`.

## UI Behavior

### Board

- `browser-view.tsx` sends presence when:
  - selected todo changes
  - editor opens/closes
  - component unmounts (clears presence)

### Card visuals

- `TodoCard.tsx` shows:
  - viewer count badge
  - edit badge when remote editor exists
- card wrapper gets subtle presence outline tint in board view.

### Editor dialog

- `TaskCardEditor.tsx` shows remote editor avatars for the current todo.

## Archived View

Archived view uses CRDT data source in team mode for read/write operations, but v1 presence UI is focused on active board cards and task editor interactions.

## Current Limits / Follow-ups

1. v1 board UI still renders fixed status columns (plus optional `Later`) even though CRDT board layout supports generic columns.
2. Presence is intentionally ephemeral and not persisted.
3. Multi-machine team relay is behind sidecar relay config (`CRDT_RELAY_ENABLED`) and uses workspace-scoped doc IDs.
   Implementation plan: `docs/specs/team/phase-3-team-backend-relay-plan.md`
