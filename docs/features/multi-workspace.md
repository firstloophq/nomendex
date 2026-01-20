# Multi-Workspace Architecture

This document describes the multi-workspace support implementation, allowing users to manage multiple isolated workspaces, each with their own todos, notes, uploads, and settings.

## Overview

Each workspace is a folder on the filesystem that contains all user data for that workspace. Global app configuration (list of workspaces, active workspace) is stored separately in the macOS Application Support directory.

## Data Structure

### Global Config

**Location:** `~/Library/Application Support/com.firstloop.nomendex/config.json`

```typescript
interface GlobalConfig {
  workspaces: Array<{
    id: string;              // UUID
    path: string;            // Absolute path to workspace folder
    name: string;            // Display name (folder basename or custom)
    createdAt: string;       // ISO timestamp
    lastAccessedAt: string;  // ISO timestamp
  }>;
  activeWorkspaceId: string | null;
}
```

### Per-Workspace Data

Each workspace folder contains:

```
/path/to/workspace/
├── todos/             # Todo items (markdown with YAML frontmatter)
├── notes/             # Notes
├── uploads/           # Uploaded images and attachments
├── agents/            # Agent configurations
└── .claude/skills/    # Custom skills
```

## Key Design Decisions

### App Reload on Workspace Switch

When switching workspaces, the app performs a full page reload (`window.location.reload()`). This approach was chosen because:

1. Many services are initialized at module load time (FileDatabase, FeatureStorage)
2. Runtime re-initialization would require complex state management
3. A clean reload ensures all services start fresh with the new workspace paths
4. Avoids potential memory leaks from lingering references

### Lazy Service Initialization

Services that depend on workspace paths use lazy initialization:

```typescript
let todosDb: FileDatabase<Todo> | null = null;

export async function initializeTodosService(): Promise<void> {
    if (!hasActiveWorkspace()) return;
    todosDb = new FileDatabase<Todo>(getTodosPath());
    await todosDb.initialize();
}

function getDb(): FileDatabase<Todo> {
    if (!todosDb) throw new Error("Todos service not initialized");
    return todosDb;
}
```

### Native vs Web Folder Picker

The app supports two folder picker modes:

1. **Native (macOS app):** Uses `NSOpenPanel` via WebKit message handlers
2. **Web (browser/dev):** Uses a custom `FolderPickerDialog` component

Detection:
```typescript
const isNativeApp = Boolean(
    window.webkit?.messageHandlers?.chooseDataRoot
);
```

## Backend Components

### Global Config Manager

**File:** `src/storage/global-config.ts`

Manages the global configuration file with methods for:
- `load()` / `save()` - Read/write config
- `getActiveWorkspace()` - Get current workspace info
- `setActiveWorkspace(id)` - Switch active workspace
- `addWorkspace(path)` - Add a new workspace
- `removeWorkspace(id)` - Remove a workspace from the list

### Dynamic Path Provider

**File:** `src/storage/root-path.ts`

Provides workspace-aware path getters:

```typescript
export function getRootPath(): string;
export function getTodosPath(): string;
export function getNotesPath(): string;
export function getAgentsPath(): string;
export function getSkillsPath(): string;
export function getUploadsPath(): string;
export function hasActiveWorkspace(): boolean;
export async function initializePaths(): Promise<void>;
```

All paths throw if no workspace is active.

### Workspace Initialization

**File:** `src/services/workspace-init.ts`

Centralized initialization called on startup and after workspace add/switch:

```typescript
export async function initializeWorkspaceServices(): Promise<void> {
    await initializePaths();
    await secrets.loadIntoProcessEnv();
    await onStartup();  // Creates directories
    if (hasActiveWorkspace()) {
        await initializeTodosService();
        await initializeNotesService();
    }
}
```

### Workspace API Routes

**File:** `src/server-routes/workspaces-routes.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workspaces` | GET | List all workspaces |
| `/api/workspaces/active` | GET | Get active workspace |
| `/api/workspaces/switch` | POST | Switch to a workspace (triggers reload) |
| `/api/workspaces/add` | POST | Add new workspace |
| `/api/workspaces/remove` | POST | Remove workspace from list |
| `/api/workspaces/rename` | POST | Rename a workspace |

### Filesystem API Routes

**File:** `src/server-routes/filesystem-routes.ts`

Used by the web folder picker:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/filesystem/list` | POST | List directory contents |
| `/api/filesystem/quick-access` | GET | Get quick access paths (Home, Documents, etc.) |
| `/api/filesystem/validate` | POST | Validate a path is a directory |
| `/api/filesystem/create-folder` | POST | Create a new folder |

## Frontend Components

### WorkspaceSwitcher

**File:** `src/components/WorkspaceSwitcher.tsx`

Dropdown menu in the sidebar footer showing:
- Current workspace name
- List of all workspaces (click to switch)
- "Add Workspace..." option
- "Manage Workspaces..." option

### WorkspaceManager

**File:** `src/components/WorkspaceManager.tsx`

Dialog for managing workspaces:
- View all workspaces with paths
- Switch to any workspace
- Remove workspaces (with confirmation)
- Add new workspaces

### WorkspaceOnboarding

**File:** `src/components/WorkspaceOnboarding.tsx`

First-run screen shown when no workspace is configured:
- Welcome message
- "Choose Workspace Folder" button

### FolderPickerDialog

**File:** `src/components/FolderPickerDialog.tsx`

Web-based folder browser (fallback for browser/dev mode):
- Quick access sidebar (Home, Documents, Downloads, etc.)
- Directory listing with navigation
- Breadcrumb path navigation
- Fuzzy search to filter folders
- Create new folder inline
- Manual path input

### useWorkspaceSwitcher Hook

**File:** `src/hooks/useWorkspaceSwitcher.ts`

```typescript
function useWorkspaceSwitcher(): {
    workspaces: WorkspaceInfo[];
    activeWorkspace: WorkspaceInfo | null;
    loading: boolean;
    error: string | null;
    switchWorkspace: (id: string) => Promise<void>;
    addWorkspace: (path: string) => Promise<void>;
    removeWorkspace: (id: string) => Promise<void>;
    renameWorkspace: (id: string, name: string) => Promise<void>;
    refresh: () => Promise<void>;
}
```

## Native macOS Integration

The Swift/macOS app provides native folder picking via WebKit message handlers:

```swift
// Swift side registers handler
webView.configuration.userContentController.addScriptMessageHandler(
    self, name: "chooseDataRoot"
)

// JavaScript calls it
window.webkit.messageHandlers.chooseDataRoot.postMessage({});

// Swift shows NSOpenPanel and calls back
webView.evaluateJavaScript("window.__setDataRoot('\(path)')")
```

The frontend sets up the callback:
```typescript
useEffect(() => {
    window.__setDataRoot = (path: string) => {
        addWorkspace(path);
    };
    return () => { delete window.__setDataRoot; };
}, [addWorkspace]);
```

## Startup Flow

1. Server starts, calls `initializeWorkspaceServices()`
2. `initializePaths()` reads global config, sets up path cache
3. If no active workspace, paths remain null
4. Frontend loads, `useWorkspaceSwitcher` fetches workspace state
5. If no active workspace, shows `WorkspaceOnboarding`
6. User selects folder, `addWorkspace()` is called
7. Backend adds workspace, sets as active, returns success
8. Frontend reloads, services initialize with new workspace

## Workspace Switch Flow

1. User clicks workspace in `WorkspaceSwitcher`
2. `switchWorkspace(id)` calls `/api/workspaces/switch`
3. Backend updates `activeWorkspaceId` in global config
4. Backend calls `initializeWorkspaceServices()` to reinitialize
5. Returns `{ success: true, requiresReload: true }`
6. Frontend calls `window.location.reload()`
7. App restarts with new workspace active

## Error Handling

- If workspace folder doesn't exist, it's created on first use
- If global config is corrupted, it's reset to empty state
- If active workspace is removed, app reloads to show onboarding (if no workspaces) or switches to first available
