# Hosted Auth Proxy

## Problem

Clerk's production auth (`pk_live_`) needs same-site cookies between the app domain and Clerk's FAPI domain. Nomendex runs on `localhost` inside a WKWebView. In dev mode, Clerk uses a `__clerk_db_jwt` querystring hack that is explicitly not production-safe. Production keys won't work with localhost at all.

Currently `AuthContext.tsx` wraps the app in `<ClerkProvider>` and calls `useAuth().getToken()` directly inside the WebView. This works in development but breaks in production.

## Design principles

- **Clerk = identity provider.** Clerk owns users, sessions, and JWTs.
- **team-backend = session authority.** It proxies Clerk, issues app JWTs, and handles refresh via the Clerk server API.
- **Nomendex desktop = public client.** It never touches Clerk directly. It authenticates through `team-backend` using the system browser.
- **No Clerk SDK on the client.** Remove `@clerk/clerk-react` entirely. One code path, no conditional dev/prod behavior. Sign-in always goes through the system browser, even in development.
- **No custom refresh tokens.** Clerk handles session lifecycle. The backend stores a `clerkSessionId` and uses the Clerk server API to mint fresh JWTs on demand.
- **No raw Clerk JWTs in the database.** Validate immediately, extract claims, discard.

This is the same pattern used by GitHub Desktop, VS Code, Notion, and Figma.

## Solution

Move the sign-in flow out of the WebView and onto `team-backend`, deployed at `team.nomendex.com` where Clerk cookies work. After auth completes, pass a one-time code back to the local app. Remove `@clerk/clerk-react` from the client entirely.

## Flow

```
┌─────────────────┐     1. Click "Sign In"        ┌──────────────┐
│  Nomendex App   │ ─────────────────────────────► │  System      │
│  (WKWebView +   │     (opens system browser)     │  Browser     │
│   Bun localhost) │                                │              │
│                  │     5. Redirect back           │              │
│                  │ ◄───────────────────────────── │              │
│                  │  nomendex://auth-callback       │              │
│                  │  ?code=CODE&state=NONCE         │              │
└────────┬────────┘                                 └──────┬───────┘
         │                                                 │
         │  6. Exchange code                        2. Navigate to
         │  POST /auth/exchange                     team.nomendex.com
         │  { code, deviceId }                      /auth/sign-in
         ▼                                                 │
┌─────────────────┐                                        ▼
│  team-backend   │◄──────────────────────────────────────────
│  (Hono, real    │  3. Clerk sign-in (cookies work)
│   domain)       │  4. Generate one-time code, redirect
│                 │
│  PostgreSQL     │
│  Prisma         │
└─────────────────┘
         │
         │  7. Ongoing refresh
         │  POST /auth/refresh { clerkSessionId, deviceId }
         │  → team-backend calls Clerk server API
         │  → returns fresh app JWT
         ▼
```

## Step by step

1. **User clicks "Sign In"** — Swift opens the system browser (not the WebView) to `https://team.nomendex.com/auth/sign-in?device_id=DEVICE_ID&state=RANDOM_NONCE`. The `device_id` is a random UUID generated on first app launch and persisted in the global config.
2. **team-backend serves a Clerk sign-in page** — a small HTML page that loads `@clerk/clerk-js` from CDN. Since it's on a real domain, cookies work normally.
3. **User authenticates** — standard Clerk flow (social OAuth, email/password, etc.)
4. **team-backend generates a one-time code** — after sign-in, the page calls `getToken()`, posts the JWT to `POST /auth/create-code`. The backend validates the JWT immediately, extracts `sub` (clerkUserId) and `sid` (clerkSessionId), discards the raw JWT, stores a one-time code in PostgreSQL (60s expiry) bound to the `deviceId` and `state`. Redirects the browser to `nomendex://auth-callback?code={CODE}&state={NONCE}`.
5. **Swift intercepts the custom URL scheme** — the native app receives the `nomendex://auth-callback` URL, extracts the code and state, and passes them to the Bun server.
6. **Code exchange** — Bun server calls `POST /auth/exchange` on team-backend with `{ code, deviceId }`. team-backend validates it (single-use, not expired, deviceId matches), deletes it, uses the Clerk server API to mint a fresh JWT for the session, and returns `{ appJwt, clerkSessionId, user, expiresAt }`.
7. **Ongoing refresh** — Bun server stores the `clerkSessionId` locally. Every ~4 minutes (for a 5-minute app JWT), it calls `POST /auth/refresh` on team-backend with `{ clerkSessionId, deviceId }`. team-backend calls the Clerk server API to check the session is still valid and mint a fresh JWT. The JWT is served to the WebView via a local API route.

## New team-backend routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/auth/sign-in` | GET | None | Serves static HTML page with Clerk `<SignIn>` (loaded from CDN) |
| `/auth/create-code` | POST | Clerk JWT | Validates JWT, extracts claims, creates one-time code in DB |
| `/auth/exchange` | POST | None (code + deviceId) | Validates one-time code, returns app JWT + session info + user |
| `/auth/refresh` | POST | clerkSessionId + deviceId | Calls Clerk server API, returns fresh app JWT |
| `/auth/revoke` | POST | clerkSessionId + deviceId | Revokes the Clerk session (sign-out) |

### Clerk Backend SDK usage

```typescript
import { createClerkClient } from '@clerk/backend'
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

// Mint fresh JWT from session ID (no template = default Clerk claims)
const token = await clerkClient.sessions.getToken(clerkSessionId)
// token.jwt is the JWT string

// Check session is still active
const session = await clerkClient.sessions.getSession(sessionId)
// session.status === 'active'

// Revoke on sign-out
await clerkClient.sessions.revokeSession(sessionId)
```

## New Prisma model

```prisma
model AuthCode {
  code             String   @id @default(cuid())
  clerkUserId      String
  clerkSessionId   String
  deviceId         String
  state            String
  createdAt        DateTime @default(now())
  expiresAt        DateTime // createdAt + 60s
  used             Boolean  @default(false)

  @@map("auth_codes")
}
```

No refresh token table needed — Clerk owns session lifecycle. The desktop app stores `clerkSessionId` locally and team-backend uses it to call the Clerk server API on refresh.

## Bun sidecar changes

- **`src/server-routes/auth-routes.ts`** — New. Handles `GET /api/auth/token` (serves current app JWT to the WebView), `GET /api/auth/status` (signed-in state), and the internal callback handler that receives the code from Swift.
- **`src/contexts/AuthContext.tsx`** — Rewrite. Remove `@clerk/clerk-react` and `ClerkProvider` entirely. `getToken()` fetches from local Bun server (`/api/auth/token`). Sign-in sends a message to Swift to open the system browser. Sign-out calls team-backend's `/auth/revoke`. The `TeamAuthContextValue` interface stays the same — downstream consumers don't change.
- **`src/storage/global-config.ts`** — Add `deviceId` (generated once on first launch), `clerkSessionId`, and cached `authUser` info.
- **`src/App.tsx`** — Remove `ClerkProvider` wrapper. `AuthProvider` becomes a plain React context provider.
- **`package.json`** — Remove `@clerk/clerk-react` dependency.

## Swift changes

- Register `nomendex://` custom URL scheme in the app's `Info.plist`
- Handle `nomendex://auth-callback?code=...&state=...` — forward code and state to the Bun server via `window.__authCallback(code, state)`
- Add `startSignIn` message handler in `WebViewWindowController.swift` — opens system browser via `NSWorkspace.shared.open()`
- Generate and persist `deviceId` on first launch, inject into WebView as `window.__DEVICE_ID__`

## What stays the same

- **Clerk JWT format unchanged** — team-backend still verifies Clerk JWTs using JWKS for all existing API routes
- **CollabContext** — calls `useTeamAuth().getToken()`, no changes needed
- **GHSyncContext** — calls `useTeamAuth().getToken()`, no changes needed
- **GitHubRepoPickerDialog** — calls `useTeamAuth().getToken()` via `fetchWithAuth()`, no changes needed
- **team-backend existing API routes** — still validate JWTs via `authMiddleware`, same JWKS verification
- **Solo mode** — completely unaffected, auth only matters in team mode

## Security

| Concern | Mitigation |
|---|---|
| One-time code interception | 60-second expiry, single-use, bound to `deviceId` + `state` nonce |
| Cross-app code theft | `deviceId` is unique per install, required on exchange — another process can't use a stolen code |
| Localhost port hijacking | Custom URL scheme avoids localhost entirely in production |
| Token leaking in logs | One-time code (not the JWT) goes through the redirect URL. JWT only transmitted server-to-server |
| Database leak exposure | No raw Clerk JWTs stored. Only `clerkSessionId` and `clerkUserId` in auth codes |
| Session revocation | Handled by Clerk — revoking a session in Clerk Dashboard immediately invalidates refresh |

## Offline mode

When the machine is offline, the app JWT expires (5-minute lifetime) and can't be refreshed. Rather than stretching JWT validity, treat offline as a distinct mode:

- **Cache the last-known user identity** locally (name, image, userId) for display purposes
- **Disable team sync** — CollabContext disconnects, no WebSocket
- **Disable remote writes** — team-backend API calls fail gracefully
- **Show "Offline" badge** in the UI
- **Allow local-only work** — solo mode features continue to function
- **Auto-reconnect** — when online again, refresh the JWT and resume sync

The app should never pretend to be authorized for remote operations when offline.

## Implementation summary

| Layer | File | Status |
|---|---|---|
| team-backend | `src/routes/auth.ts` | **New** — 5 auth routes |
| team-backend | `src/auth-page.html` | **New** — static Clerk sign-in page (loads `@clerk/clerk-js` from CDN) |
| team-backend | `prisma/schema.prisma` | **Edit** — add `AuthCode` model |
| team-backend | `src/server.ts` | **Edit** — mount auth routes outside `authMiddleware` |
| team-backend | `package.json` | **Edit** — add `@clerk/backend` |
| team-backend | `Dockerfile` | **New** — for deployment to Railway |
| Swift | `Info.plist` | **Edit** — register `nomendex://` URL scheme |
| Swift | `AppDelegate.swift` | **Edit** — handle `nomendex://auth-callback` URLs |
| Swift | `WebViewWindowController.swift` | **Edit** — add `startSignIn` message handler, inject `__DEVICE_ID__` |
| Bun sidecar | `src/server-routes/auth-routes.ts` | **New** — local auth endpoints + background refresh loop |
| Bun sidecar | `src/contexts/AuthContext.tsx` | **Rewrite** — remove Clerk SDK, use local endpoints |
| Bun sidecar | `src/storage/global-config.ts` | **Edit** — add `deviceId`, `clerkSessionId`, `authUser` |
| Bun sidecar | `src/App.tsx` | **Edit** — remove `ClerkProvider` wrapper |
| Bun sidecar | `package.json` | **Edit** — remove `@clerk/clerk-react` |

## Prerequisites

- **Deploy team-backend to a real domain** — this is the blocker. Use `team.nomendex.com` (not a platform domain like `*.up.railway.app`). A custom domain is required for Clerk cookie scope, brand trust, and future provider migration.
- **`CLERK_SECRET_KEY`** — required for the `@clerk/backend` SDK. Already in `.env.example` but unused in code today.

## Open questions

- [ ] Which hosting provider for team-backend? Railway is a natural fit given existing tooling.
- [ ] Should `deviceId` be stored in macOS Keychain (via Swift bridge) or is the global config file sufficient for now?
- [ ] App JWT lifetime — 5 minutes is a good default. Should it be configurable?
