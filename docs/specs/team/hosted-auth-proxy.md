# Hosted Auth Proxy

## Problem

Clerk's production auth (`pk_live_`) needs same-site cookies between the app domain and Clerk's FAPI domain. Nomendex runs on `localhost` inside a WKWebView. In dev mode, Clerk uses a `__clerk_db_jwt` querystring hack that is explicitly not production-safe. Production keys won't work with localhost at all.

Currently `AuthContext.tsx` wraps the app in `<ClerkProvider>` and calls `useAuth().getToken()` directly inside the WebView. This works in development but breaks in production.

## Solution

Move the sign-in flow out of the WebView and onto `team-backend`, deployed to a real domain where Clerk cookies work. After auth completes, pass a one-time code back to the local app via localhost redirect.

## Flow

```
┌─────────────────┐     1. Click "Sign In"        ┌──────────────┐
│  Nomendex App   │ ─────────────────────────────► │  System      │
│  (WKWebView +   │     (opens system browser)     │  Browser     │
│   Bun localhost) │                                │              │
│                  │     5. Redirect to             │              │
│                  │ ◄───────────────────────────── │              │
│                  │  localhost:PORT/auth/callback   │              │
│                  │  ?code=CODE&state=NONCE         │              │
└────────┬────────┘                                 └──────┬───────┘
         │                                                 │
         │  6. Exchange code                        2. Navigate to
         │  POST /auth/exchange                     team-backend.example.com
         │                                          /auth/sign-in
         ▼                                                 │
┌─────────────────┐                                        ▼
│  team-backend   │◄──────────────────────────────────────────
│  (Hono, real    │  3. Clerk sign-in (cookies work)
│   domain)       │  4. Generate one-time code, redirect
│                 │
│  PostgreSQL     │
│  Prisma         │
└─────────────────┘
```

## Step by step

1. **User clicks "Sign In"** — Swift opens the system browser (not the WebView) to `https://team.nomendex.com/auth/sign-in?callback_port=PORT&state=RANDOM_NONCE`
2. **team-backend serves a Clerk sign-in page** — a small HTML page that loads the Clerk React SDK. Since it's on a real domain, cookies work normally.
3. **User authenticates** — standard Clerk flow (social OAuth, email/password, etc.)
4. **team-backend generates a one-time code** — after sign-in, the page calls `getToken()`, posts the JWT to `POST /auth/create-code`. The backend validates the JWT, stores a one-time code in PostgreSQL (60s expiry), and redirects the browser to `http://localhost:{callback_port}/auth/callback?code={CODE}&state={NONCE}`
5. **Bun server receives the callback** — new route `GET /auth/callback` verifies the state nonce matches, renders a "You can close this tab" page
6. **Code exchange** — Bun server calls `POST /auth/exchange` on team-backend with the one-time code. team-backend validates it (single-use, not expired), deletes it, and returns a JWT + refresh token + user info
7. **Ongoing refresh** — Bun server stores the refresh token locally. Every ~50s it calls `POST /auth/refresh` on team-backend to get a fresh JWT. The JWT is served to the WebView via a local API route.

## New team-backend routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/auth/sign-in` | GET | None | Serves static HTML page with Clerk `<SignIn>` |
| `/auth/create-code` | POST | Clerk JWT | Validates JWT, creates one-time code in DB |
| `/auth/exchange` | POST | None (code is the credential) | Accepts one-time code, returns JWT + refresh token + user |
| `/auth/refresh` | POST | Refresh token | Accepts refresh token, returns fresh JWT |
| `/auth/revoke` | POST | Refresh token | Invalidates refresh token (sign-out) |

## New Prisma models

```prisma
model AuthCode {
  code          String   @id @default(cuid())
  clerkUserId   String
  clerkJwt      String
  callbackPort  Int
  state         String
  createdAt     DateTime @default(now())
  expiresAt     DateTime // createdAt + 60s
  used          Boolean  @default(false)

  @@map("auth_codes")
}

model RefreshToken {
  token         String   @id @default(cuid())
  clerkUserId   String
  user          User     @relation(fields: [clerkUserId], references: [clerkUserId], onDelete: Cascade)
  createdAt     DateTime @default(now())
  expiresAt     DateTime // e.g. 30 days
  revoked       Boolean  @default(false)

  @@map("refresh_tokens")
}
```

Plus add `refreshTokens RefreshToken[]` relation to the existing `User` model.

## Bun sidecar changes

- **`src/server-routes/auth-routes.ts`** — New. Handles `GET /auth/callback` (receives code from browser redirect), `GET /api/auth/token` (serves current JWT to the WebView), `GET /api/auth/status` (signed-in state)
- **`src/contexts/AuthContext.tsx`** — Replace `ClerkProvider` with proxy-based auth. `getToken()` fetches from local Bun server (`/api/auth/token`) instead of Clerk SDK. Sign-in triggers system browser open instead of Clerk modal.
- **`src/storage/global-config.ts`** — Store `refreshToken` and cached `authUser` info locally

## Swift changes

- Open system browser via `NSWorkspace.shared.open()` for sign-in (instead of rendering Clerk inside the WebView)
- Optionally register `nomendex://auth-callback` custom URL scheme as an alternative to the localhost redirect

## What stays the same

- **Clerk JWT format unchanged** — `nomendex-collab` worker and `team-backend` both still verify Clerk JWTs using JWKS, same as today
- **CollabContext WebSocket flow** — still passes `?token=JWT`, the JWT now comes from the local Bun server's stored token instead of the Clerk React SDK
- **team-backend API calls** — still get `Authorization: Bearer {clerk-jwt}`, same validation
- **Solo mode** — completely unaffected, auth only matters in team mode

## Security

| Concern | Mitigation |
|---|---|
| One-time code interception | 60-second expiry, single-use, tied to state nonce |
| Refresh token theft from disk | File permissions on `~/Library/Application Support/` are user-scoped. Future: encrypt via macOS Keychain through Swift bridge |
| Localhost port hijacking | The state nonce ensures only the app that initiated the flow can complete it |
| Token leaking in logs | One-time code (not the JWT) goes through the redirect URL. JWT only transmitted server-to-server |

## Prerequisites

- **team-backend needs to be deployed to a real domain** — this is the blocker. Needs a hosting provider (Railway, Fly, etc.) and a domain like `team.nomendex.com`
- **Static HTML sign-in page** — a small built HTML file that loads `@clerk/clerk-js` and renders the sign-in component, served by Hono as a static asset

## Open questions

- Where to deploy team-backend? (Railway is a natural fit)
- Custom domain (`team.nomendex.com`) vs platform domain (`nomendex-team.up.railway.app`)?
- Should the refresh token go in macOS Keychain via a Swift bridge, or is the global config file sufficient for now?
- Offline grace period — if the machine is offline, the JWT expires in 60s and can't refresh. Cache last-known user for local-only work?
- Custom URL scheme (`nomendex://auth-callback`) vs localhost redirect — which is more reliable on macOS?
