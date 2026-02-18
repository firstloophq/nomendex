---
name: collab-sync
description: Guide for working with the Y.js real-time collaboration sync system. Use when debugging WebSocket connections, modifying the sync layer, working on the Cloudflare Worker collab backend, editing CollabContext, or troubleshooting team mode sync issues.
---

# Collab Sync (Y.js Real-Time Collaboration)

## Architecture Overview

Two users can edit the same note in real-time with live cursors. The sync layer uses Y.js CRDTs with y-partyserver on the backend and y-prosemirror on the frontend.

```
Browser (WKWebView)                    Cloudflare Worker
+---------------------+               +---------------------+
|  CollabContext       |   WebSocket   |  index.ts (Worker)  |
|  +- WebsocketProvider|------------->|  +- auth check      |
|  +- Y.Doc           |               |  +- routePartykitRequest
|                     |               |                     |
|  ProseMirror        |               |  VaultServer (DO)   |
|  +- ySyncPlugin     |               |  extends YServer    |
|  +- yCursorPlugin   |               |  +- onLoad (storage)|
|  +- yUndoPlugin     |               |  +- onSave (storage)|
+---------------------+               +---------------------+

Bun sidecar: NOT in the sync path. Serves app + handles local file I/O.
Local .md files: Still saved by existing dispatchTransaction flow.
```

## Key Principle

The browser connects **directly** to the Cloudflare Durable Object via WebSocket. The Bun sidecar is not involved in sync.

## Connection Flow

1. Browser opens WebSocket: `ws(s)://{WORKER_HOST}/parties/vault-server/{vaultId}?token={JWT}`
2. Worker authenticates the Clerk JWT (supports `?token=` query param for WebSocket upgrades)
3. `routePartykitRequest()` routes to the `VaultServer` Durable Object
4. `VaultServer` (extends `YServer` from y-partyserver) handles Y.js sync protocol automatically
5. DO persistence: `onLoad()` reads from DO storage, `onSave()` writes (debounced by y-partyserver)

## Key Files

### Server (nomendex-collab/)

| File | Purpose |
|------|---------|
| `src/vault-do.ts` | `VaultServer extends YServer` — the Durable Object. Only has `onLoad`/`onSave` for persistence. Y.js sync protocol is handled by y-partyserver. |
| `src/index.ts` | Worker fetch handler. Routes `/parties/*` through `routePartykitRequest()` after auth. REST routes (`/api/vaults/*`) are separate. |
| `src/auth.ts` | Clerk JWT verification. Supports `Authorization: Bearer` header AND `?token=` query param. |
| `src/types.ts` | Env interface — binding is `VaultServer` (not `VAULT_DO`). |
| `wrangler.toml` | DO binding: `{ name = "VaultServer", class_name = "VaultServer" }`. Migration v2 renames from `VaultDurableObject`. |

### Client (bun-sidecar/)

| File | Purpose |
|------|---------|
| `src/contexts/CollabContext.tsx` | Creates `Y.Doc`, `WebsocketProvider`, exposes via React context. Only active when `teamMode === "team"` and user is signed in. |
| `src/contexts/AuthContext.tsx` | Clerk auth — `useTeamAuth()` provides `getToken()` for JWT. |
| `src/features/notes/note-view.tsx` | Conditionally adds `ySyncPlugin`, `yCursorPlugin`, `yUndoPlugin` in team mode. |
| `src/contexts/GHSyncContext.tsx` | Git sync — disabled when `isTeamMode` is true (Y.js handles sync instead). |
| `src/styles/collab-cursors.css` | CSS for remote cursor carets and name labels from `yCursorPlugin`. |
| `src/App.tsx` | Provider tree: `AuthProvider > CollabProviderGate > WorkspaceProvider > ...` |

## How It Works

### Mode Detection

Team mode is stored in the global config (`global-config.ts`):
```typescript
interface WorkspaceInfo {
    teamMode: "solo" | "team";
    teamVaultId?: string; // UUID of the vault on the collab server
}
```

`CollabProviderGate` in `App.tsx` checks `activeWorkspace.teamMode` and `activeWorkspace.teamVaultId`. If both are set and user is signed in, it renders `CollabProvider`. Otherwise children render without collab.

### WebSocket Host Detection

`CollabContext.tsx` auto-detects the host:
- **localhost** (dev): connects to `ws://localhost:8787` (wrangler dev)
- **production**: connects to `wss://nomendex-collab.firstloop-team.workers.dev`
- **override**: set `window.__COLLAB_WORKER_HOST__` from the native app

### Y.Doc Structure

Each note is a separate `Y.XmlFragment` within a single shared `Y.Doc` per vault:
```typescript
const yXmlFragment = ydoc.getXmlFragment(`note:${noteFileName}`);
```

### ProseMirror Plugin Setup

In team mode, the editor uses a different plugin list:

**Team mode:**
- `ySyncPlugin(yXmlFragment)` — binds ProseMirror doc to Y.js
- `yCursorPlugin(awareness)` — renders remote cursors
- `yUndoPlugin()` — per-client undo/redo via Y.UndoManager
- `exampleSetup({ history: false })` — **history disabled** to avoid conflict with yUndoPlugin

**Solo mode (unchanged):**
- `exampleSetup({ history: true })` — default prosemirror-history

### Bootstrapping (First Open)

When a note is opened in team mode and the Y.XmlFragment is empty:
1. The local `.md` file is parsed with `tableMarkdownParser`
2. The ProseMirror doc is converted to `Y.XmlFragment` via `prosemirrorToYXmlFragment()`
3. This populates the shared CRDT — other clients receive the content

### Local Save (Unchanged)

The existing `dispatchTransaction` flow still runs in team mode:
```typescript
const markdown = tableMarkdownSerializer.serialize(newState.doc);
updateContent(markdown); // -> debounced save to local .md file
```
Each client saves to their own local disk. Y.js ensures all clients converge.

### Git Sync Disabled in Team Mode

`GHSyncContext.tsx` checks `isTeamMode` and short-circuits all git operations:
- Initial setup check
- Polling for remote changes
- File watching with debounce
- Scheduled sync intervals

## Running Locally

```bash
# Terminal 1: Start the collab worker
cd nomendex-collab && bunx wrangler dev

# Terminal 2: Start the app
cd bun-sidecar && bun run dev
```

The app auto-connects to `ws://localhost:8787` when running on localhost.

## Common Issues

### WebSocket connection fails immediately
- Is `wrangler dev` running? Check port 8787.
- Check browser console for auth errors — the JWT might be expired.
- Verify the workspace has `teamMode: "team"` and a valid `teamVaultId`.

### `WebsocketProvider.url` is read-only
- Never try to set `provider.url` — it's a getter-only property.
- To reconnect with a fresh token, destroy and recreate the provider.

### React Strict Mode double initialization
- The `destroyedRef` pattern in `CollabContext.tsx` prevents double provider creation.
- The cleanup function destroys the provider on unmount.

### Editor shows empty in team mode
- The Y.XmlFragment might not have been bootstrapped. Check if the local `.md` file has content.
- The bootstrapping only happens when `yXmlFragment.length === 0` — if the fragment exists on the server but is empty, it won't re-bootstrap.

### "External changes detected" toast in team mode
- The content update useEffect has an early return when `collab` is truthy.
- If this still fires, check that `collab` is not null when expected.

## Dependencies

### nomendex-collab
- `y-partyserver` — YServer class for Durable Objects
- `partyserver` — `routePartykitRequest` routing
- `yjs`, `y-protocols`, `lib0` — Y.js core

### bun-sidecar
- `y-prosemirror` — ProseMirror plugins (`ySyncPlugin`, `yCursorPlugin`, `yUndoPlugin`, `prosemirrorToYXmlFragment`)
- `y-websocket` — `WebsocketProvider` for browser-to-server connection
- `yjs`, `y-protocols`, `lib0` — Y.js core

## PartyServer URL Convention

`routePartykitRequest` maps binding names to URL paths via kebab-case:
- Binding name: `VaultServer`
- URL path: `/parties/vault-server/{roomName}`
- Room name = vault ID (UUID)

The binding `name` in `wrangler.toml` **must match** the exported class name for `routePartykitRequest` to find it.
