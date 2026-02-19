---
id: T-001
title: "Project scaffolding and tooling setup"
status: done
priority: high
tags: [setup, tooling]
depends_on: []
created: 2026-02-17
completed: 2026-02-17
---

## Description
Set up the TypeScript project with Bun, configure tsconfig with strict mode, set up the test runner, and create the directory structure.

## Acceptance Criteria
- [x] `bun init` with proper package.json
- [x] `tsconfig.json` with strict mode, path aliases (`@/`)
- [x] CRDT directory structure created (`src/crdt/core`, `src/crdt/document`, `src/crdt/network`, `src/crdt/prosemirror`)
- [x] A trivial test runs successfully with `bun test`
- [x] Bun server entry point `src/index.ts` serves the app
- [x] React 19 frontend with Tailwind + shadcn configured

## Test Plan
- Run `bun test` and confirm the trivial test passes.
- Run `bun dev` and confirm the app loads in the browser.

## Implementation Notes
User initialized the project as a Bun + React 19 app with Tailwind CSS 4 and shadcn/ui. Server entry at `src/index.ts`, frontend entry at `src/frontend.tsx`. CRDT source lives under `src/crdt/`, tests under `tests/crdt/`. `bun test` confirmed working.
