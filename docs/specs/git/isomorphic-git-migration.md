# Isomorphic-Git Migration Proposal

## Overview

This document proposes migrating from shell-based git operations (`Bun.$`) to [isomorphic-git](https://isomorphic-git.org/), a pure JavaScript implementation of Git.

## Motivation

### Current Approach: Shell Out to Git CLI

**Pros:**
- Simple implementation
- Uses system's credential helpers (SSH agent, keychain)
- Familiar error messages
- No additional dependencies

**Cons:**
- Requires git to be installed on user's machine
- PATH augmentation needed for macOS GUI apps (lines 8-19 in git-sync.ts)
- Parsing shell output is fragile
- Can't work offline on machines without git

### Proposed Approach: isomorphic-git

**Pros:**
- No git CLI dependency - works on any machine
- Pure JavaScript - easier to debug, test, and maintain
- Consistent behavior across platforms
- Simple authentication via callbacks
- ~300KB bundle size

**Cons:**
- Pure JS is slower than native git for large repos
- SSH not built-in (HTTPS only, which is fine for GitHub PAT flow)
- Merge conflict handling requires custom UX

## Current Operations Mapping

| Route | Current Implementation | isomorphic-git Equivalent |
|-------|----------------------|---------------------------|
| `gitInstalledRoute` | `which git && git --version` | Not needed (always "installed") |
| `gitInitRoute` | `git init` | `git.init({ fs, dir })` |
| `gitStatusRoute` | `git status --short`, `git branch`, etc. | `git.status()`, `git.currentBranch()`, `git.log()` |
| `gitSetupRemoteRoute` | `git remote add/set-url` | `git.addRemote()`, modify `.git/config` |
| `gitPullRoute` | `git pull` | `git.pull({ fs, http, dir, onAuth })` |
| `gitPushRoute` | `git add -A && git commit && git push` | `git.add()`, `git.commit()`, `git.push()` |
| `gitFetchStatusRoute` | `git fetch && git rev-list` | `git.fetch()`, `git.log()` comparisons |
| `gitCommitRoute` | `git add -A && git commit` | `git.add()`, `git.commit()` |
| `gitConflictsRoute` | Check `.git/MERGE_HEAD`, parse status | Same file check, `git.status()` |
| `gitResolveConflictRoute` | `git checkout --ours/--theirs` | `git.checkout()` with `ours`/`theirs` option |
| `gitAbortMergeRoute` | `git merge --abort` | Remove `.git/MERGE_HEAD`, `git.checkout()` to reset |
| `gitContinueMergeRoute` | `git commit` | `git.commit()` |
| `gitConflictContentRoute` | `git show :2:file`, `git show :3:file` | `git.readBlob()` with stage numbers |

## Detailed API Mapping

### 1. Repository Initialization

```typescript
// Current
await $`cd ${path} && git init`;

// isomorphic-git
import git from "isomorphic-git";
import * as fs from "node:fs";

await git.init({ fs, dir: path });
```

### 2. Status Check

```typescript
// Current (multiple shell commands)
const branch = await $`git branch --show-current`.text();
const status = await $`git status --short`.text();
const log = await $`git log -5 --pretty=format:%H|%s|%an|%ar`.text();

// isomorphic-git
const branch = await git.currentBranch({ fs, dir });
const files = await git.statusMatrix({ fs, dir });
const commits = await git.log({ fs, dir, depth: 5 });

// Status matrix returns [filepath, HEAD, WORKDIR, STAGE]
// 0 = absent, 1 = identical to HEAD, 2 = different from HEAD
const changedFiles = files.filter(([_, head, workdir, stage]) =>
  head !== workdir || head !== stage
);
```

### 3. Remote Setup

```typescript
// Current
await $`git remote add origin ${url}`;
await $`git remote set-url origin ${url}`;

// isomorphic-git
await git.addRemote({ fs, dir, remote: "origin", url });
// To update, delete and re-add or modify .git/config directly
await git.deleteRemote({ fs, dir, remote: "origin" });
await git.addRemote({ fs, dir, remote: "origin", url: newUrl });
```

### 4. Pull

```typescript
// Current
const authUrl = injectPATIntoUrl(url, pat);
await $`git pull ${authUrl} ${branch}`;

// isomorphic-git
await git.pull({
  fs,
  http,
  dir,
  ref: branch,
  singleBranch: true,
  onAuth: () => ({ username: pat }), // GitHub PAT as username
  author: { name: "Noetect", email: "sync@noetect.app" },
});
```

### 5. Push

```typescript
// Current
await $`git add -A`;
await $`git commit -m ${message}`;
await $`git push ${authUrl} ${branch}`;

// isomorphic-git
// Stage all files
const files = await git.statusMatrix({ fs, dir });
for (const [filepath, _, workdir] of files) {
  if (workdir === 0) {
    await git.remove({ fs, dir, filepath });
  } else {
    await git.add({ fs, dir, filepath });
  }
}

// Commit
await git.commit({
  fs,
  dir,
  message,
  author: { name: "Noetect", email: "sync@noetect.app" },
});

// Push
await git.push({
  fs,
  http,
  dir,
  remote: "origin",
  ref: branch,
  onAuth: () => ({ username: pat }),
});
```

### 6. Fetch Status (Behind/Ahead Counts)

```typescript
// Current
await $`git fetch ${authUrl} ${branch}`;
const behind = await $`git rev-list HEAD..origin/${branch} --count`.text();
const ahead = await $`git rev-list origin/${branch}..HEAD --count`.text();

// isomorphic-git
await git.fetch({
  fs,
  http,
  dir,
  remote: "origin",
  ref: branch,
  singleBranch: true,
  onAuth: () => ({ username: pat }),
});

const localCommits = await git.log({ fs, dir, ref: branch });
const remoteCommits = await git.log({ fs, dir, ref: `origin/${branch}` });

// Find common ancestor and count divergence
const localOids = new Set(localCommits.map(c => c.oid));
const remoteOids = new Set(remoteCommits.map(c => c.oid));

const ahead = localCommits.filter(c => !remoteOids.has(c.oid)).length;
const behind = remoteCommits.filter(c => !localOids.has(c.oid)).length;
```

### 7. Merge Conflict Handling

```typescript
// Current: Check .git/MERGE_HEAD exists
const hasMerge = await Bun.file(`${dir}/.git/MERGE_HEAD`).exists();

// Current: Resolve with ours/theirs
await $`git checkout --ours ${filepath} && git add ${filepath}`;

// isomorphic-git - same file check works
const hasMerge = await Bun.file(`${dir}/.git/MERGE_HEAD`).exists();

// Resolve with ours (stage 2) or theirs (stage 3)
// Read the blob from the desired stage
const { blob } = await git.readBlob({
  fs,
  dir,
  oid: stageOid, // Get from index
  filepath,
});
await fs.promises.writeFile(`${dir}/${filepath}`, Buffer.from(blob));
await git.add({ fs, dir, filepath });
```

### 8. Get Conflict Content (Ours/Theirs/Merged)

```typescript
// Current
const ours = await $`git show :2:${filepath}`.text();
const theirs = await $`git show :3:${filepath}`.text();

// isomorphic-git
// Read index entries with conflict stages
const index = await git.readIndex({ fs, dir });
const entry = index.find(e => e.path === filepath);

// Stage 2 = ours, Stage 3 = theirs
const oursBlob = await git.readBlob({ fs, dir, oid: entry.stages[2]?.oid });
const theirsBlob = await git.readBlob({ fs, dir, oid: entry.stages[3]?.oid });
```

## Implementation Plan

### Phase 1: Add Dependency & Create Wrapper

1. Install isomorphic-git: `bun add isomorphic-git`
2. Create `src/lib/git.ts` wrapper module with typed functions
3. Keep existing shell-based implementation as fallback

### Phase 2: Migrate Non-Auth Operations

Migrate in order of complexity:
1. `git.init()` - simplest
2. `git.currentBranch()`, `git.listBranches()`
3. `git.status()` via `statusMatrix()`
4. `git.log()` for commit history
5. `git.add()`, `git.remove()`, `git.commit()`

### Phase 3: Migrate Auth Operations

1. `git.fetch()` with `onAuth` callback
2. `git.pull()` with `onAuth` callback
3. `git.push()` with `onAuth` callback

### Phase 4: Migrate Conflict Handling

1. `git.merge()` with `abortOnConflict: false`
2. Conflict detection via status and `.git/MERGE_HEAD`
3. Conflict resolution via `readBlob()` + file write + `add()`

### Phase 5: Remove Shell Fallback

1. Remove `Bun.$` git commands
2. Remove PATH augmentation code
3. Remove `gitInstalledRoute` (or make it always return installed: true)

## Proposed Wrapper API

```typescript
// src/lib/git.ts
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "node:fs";

interface GitConfig {
  dir: string;
  author?: { name: string; email: string };
}

interface AuthConfig {
  token: string;
}

export function createGitClient(config: GitConfig) {
  const { dir, author = { name: "Noetect", email: "sync@noetect.app" } } = config;

  return {
    async init() {
      await git.init({ fs, dir });
    },

    async currentBranch(): Promise<string | undefined> {
      return await git.currentBranch({ fs, dir }) ?? undefined;
    },

    async listBranches(): Promise<string[]> {
      return await git.listBranches({ fs, dir });
    },

    async status(): Promise<StatusResult> {
      const matrix = await git.statusMatrix({ fs, dir });
      // Transform matrix to friendly format
      return transformStatusMatrix(matrix);
    },

    async log(opts: { depth?: number } = {}): Promise<CommitInfo[]> {
      const commits = await git.log({ fs, dir, depth: opts.depth ?? 10 });
      return commits.map(c => ({
        hash: c.oid.slice(0, 7),
        message: c.commit.message,
        author: c.commit.author.name,
        date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      }));
    },

    async addAll() {
      const matrix = await git.statusMatrix({ fs, dir });
      for (const [filepath, , workdir] of matrix) {
        if (workdir === 0) {
          await git.remove({ fs, dir, filepath });
        } else if (workdir !== 1) {
          await git.add({ fs, dir, filepath });
        }
      }
    },

    async commit(message: string): Promise<string> {
      return await git.commit({ fs, dir, message, author });
    },

    async fetch(auth: AuthConfig) {
      await git.fetch({
        fs,
        http,
        dir,
        onAuth: () => ({ username: auth.token }),
      });
    },

    async pull(auth: AuthConfig) {
      await git.pull({
        fs,
        http,
        dir,
        onAuth: () => ({ username: auth.token }),
        author,
      });
    },

    async push(auth: AuthConfig) {
      await git.push({
        fs,
        http,
        dir,
        onAuth: () => ({ username: auth.token }),
      });
    },

    async addRemote(name: string, url: string) {
      await git.addRemote({ fs, dir, remote: name, url });
    },

    async getRemoteUrl(name: string): Promise<string | undefined> {
      const remotes = await git.listRemotes({ fs, dir });
      return remotes.find(r => r.remote === name)?.url;
    },
  };
}
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Performance on large repos | Profile with real workspaces; consider shallow clones |
| SSH authentication not supported | Use HTTPS + PAT (current approach already does this) |
| Merge conflict UX complexity | Start with abort-on-conflict, add resolution UI later |
| Edge cases in git behavior | Extensive testing against real repos |
| Bundle size increase (~300KB) | Acceptable for desktop app |

## Testing Strategy

1. **Unit tests** for the wrapper API against a test repo
2. **Integration tests** for pull/push with a real GitHub repo
3. **Manual testing** for conflict resolution flows
4. **Comparison testing** - run both implementations, compare results

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Wrapper setup | 2-3 hours |
| Phase 2: Non-auth operations | 4-6 hours |
| Phase 3: Auth operations | 2-3 hours |
| Phase 4: Conflict handling | 4-6 hours |
| Phase 5: Cleanup & testing | 2-3 hours |
| **Total** | **~2 days** |

## Decision

**Recommendation: Proceed with isomorphic-git migration**

The main benefits are:
1. No git CLI dependency - app works on any Mac
2. Simpler authentication (callback vs URL injection)
3. Better error handling (JS exceptions vs parsing shell output)
4. Easier to test and maintain

The current shell-based implementation works well, so this is not urgent. Consider migrating when:
- Users report issues with git not being installed
- We need to support Windows/Linux (PATH handling differs)
- We want better control over git operations (e.g., progress callbacks)
