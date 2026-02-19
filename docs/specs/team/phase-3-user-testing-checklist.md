# Phase 3 User Testing Checklist

## 1) Environment setup

### team-backend

Set `team-backend/.env` (starting from `team-backend/.env.example`):

- `DATABASE_URL`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `PORT` (default `4444`)
- `CRDT_SNAPSHOT_BUCKET`
- `CRDT_S3_ENDPOINT`
- `CRDT_S3_REGION`
- `CRDT_S3_ACCESS_KEY_ID`
- `CRDT_S3_SECRET_ACCESS_KEY`
- optional: `CRDT_SNAPSHOT_PREFIX`, `CRDT_CHECKPOINT_OP_THRESHOLD`

Apply migrations:

```bash
cd team-backend
bunx prisma migrate deploy
```

### bun-sidecar

Set `bun-sidecar/.env` (starting from `bun-sidecar/.env.example`):

- `TEAM_BACKEND_HTTP_URL` (production team-backend URL)
- optional: `TEAM_BACKEND_WS_URL` (if different from HTTP-derived `/ws/crdt`)
- `CRDT_RELAY_ENABLED=true`

## 2) Start services

```bash
cd team-backend && bun dev
cd bun-sidecar && bun dev
```

## 3) Verify relay is active

From sidecar logs, confirm:

- `CRDT relay enabled` at startup
- `CRDT relay connected` after first team-mode collab websocket connects

## 4) Team-mode acceptance scenarios

Use two clients/users on the same team workspace (`teamMode === "team"`):

1. Notes:
   - Open same note in both clients.
   - Edit in A, verify B updates in real time.
   - Edit in B, verify A updates in real time.
2. Kanban:
   - Open same project board in both clients.
   - Create/edit/move/archive cards in A, verify B updates in real time.
   - Repeat from B to A.
3. Presence:
   - Select a card in A, verify focus indicator in B.
   - Open card editor in A, verify editing indicator in B.

## 5) Durability checks

1. Make note/kanban edits in team mode.
2. Restart `team-backend`.
3. Reopen/reconnect clients and verify state resumes (no data loss).

## 6) Solo-mode regression check

Switch to a solo workspace and verify:

- Notes and todos still work without team relay.
- File-backed todo behavior remains intact.
