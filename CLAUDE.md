# Nomendex
Nomendex is a desktop application for working with notes, tasks, and AI agents.

It is NOT an Electron app. It is a desktop application built with Bun and React. Bun is used as a sidebar within a MacOS Swift container.

## Build Commands

- `bun run dev` - Start development server with hot reload (port 1234 default)
- `bun run build` - Run full build validation (Tailwind CSS, ESLint, TypeScript checking)

**CRITICAL**: Always run `bun run build` after making changes to validate TypeScript and linting.

## Architecture Overview

### Features
The application has two built-in features:
- **Todos** (`/src/features/todos/`) - Task management with kanban, projects, archive
- **Notes** (`/src/features/notes/`) - Markdown note-taking with file browser

### Core Technologies
- **Runtime**: Bun (not Node.js) - use `bun` for all commands
- **Framework**: React 19 with server-side rendering via Bun.serve()
- **Routing**: React Router (react-router-dom)
- **Styling**: Tailwind CSS + shadcn/ui components + Theme system
- **Type Safety**: TypeScript with Zod for runtime validation
- **State Management**: React hooks with feature-specific API hooks

### Workspace Data Storage
Each user can create a workspace which is a folder on the filesystem that contains all user data for that workspace.

**Global Config** (`src/storage/global-config.ts`):
- Stored at `~/Library/Application Support/com.firstloop.nomendex/config.json`
- Tracks all workspaces and which one is active
```typescript
interface GlobalConfig {
    workspaces: WorkspaceInfo[];  // id, path, name, createdAt, lastAccessedAt
    activeWorkspaceId: string | null;
}
```

**Workspace Paths** (`src/storage/root-path.ts`):
- `getRootPath()`, `getTodosPath()`, `getNotesPath()`, `getAgentsPath()`, `getSkillsPath()`, `getUploadsPath()`
- `hasActiveWorkspace()` - check before accessing paths

**Workspace Directory Structure**:
```
/path/to/workspace/
├── todos/              # Todo items (markdown + YAML frontmatter)
├── notes/              # Notes
├── uploads/            # Images and attachments
├── agents/             # Agent configurations
├── .claude/skills/     # Custom skills
└── workspace.json      # UI state (tabs, theme, etc.)
```

**Workspace State** (`src/types/Workspace.ts`):
- Stored in `{workspace}/workspace.json`
- Contains tabs, activeTabId, sidebarOpen, themeName, mcpServerConfigs

**Key Hooks**:
- `useWorkspace.tsx` - Manages workspace UI state (tabs, theme)
- `useWorkspaceSwitcher.ts` - Switch/add/remove workspaces

**API Routes**:
- `/api/workspaces` - List all workspaces
- `/api/workspaces/active` - Get active workspace
- `/api/workspaces/switch` - Switch workspace (triggers reload)
- `/api/workspace` - GET/POST workspace state

## Feature Structure

Each feature follows this pattern:

```
src/features/[feature]/
├── index.ts           # Feature definition, types, and exports
├── fx.ts              # Server-side function implementations
├── view.tsx           # Main view component
├── browser-view.tsx   # Browser/list view component
└── commands.tsx       # Command palette commands
```

### API Pattern

#### Server-side routes (`/src/server-routes/`)
```typescript
// todos-routes.ts
import { getTodos, createTodo } from "@/features/todos/fx";

export const todosRoutes = {
    "/api/todos/list": {
        async POST(req: Request) {
            const args = await req.json();
            return Response.json(await getTodos(args));
        },
    },
};
```

#### Client-side API hooks (`/src/hooks/`)
```typescript
// useTodosAPI.ts
export const todosAPI = {
    getTodos: (args) => fetchAPI<Todo[]>("list", args),
    createTodo: (args) => fetchAPI<Todo>("create", args),
};

// Hook wrapper for React components
export function useTodosAPI() {
    return todosAPI;
}
```

#### Using in components
```typescript
// In React components (use hook)
const api = useTodosAPI();
const todos = await api.getTodos({});

// Outside React (use standalone API)
import { todosAPI } from "@/hooks/useTodosAPI";
const todos = await todosAPI.getTodos({});
```

## Routing

Uses React Router with routes defined in `App.tsx`:
- `/` - WorkspacePage (main workspace with tabs)
- `/settings` - SettingsPage
- `/sync` - SyncPage
- `/mcp-clients` - McpClientsPage
- `/tests` - TestsPage

## Design System

### Theme System
```typescript
import { useTheme } from "@/hooks/useTheme";
const { currentTheme } = useTheme();
```

### Component Library
- Use shadcn/ui components from `@/components/ui/*`
- Focus on composability and reusability
- Keep animations subtle (scale-[1.02], not scale-110)

### Keyboard Shortcuts
```tsx
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
<Button><KeyboardIndicator keys={['cmd', 'n']} /> New</Button>
```

### Application Design Principles
- Reuse previously defined components over creating net new code. Especially when reusing dialogs and similar.
- Try to hide buttons to keep visual complexity down. Reveal on hover is a good technique.
- Always use `useTheme` for styling
- Add commands for functionality over discrete buttons

## Critical Implementation Rules

### Type Safety
- **NEVER use `any` type** - build will fail
- Use Zod schemas and infer types from them
- Validate all inputs and outputs at runtime

### Centralized Types
- **NEVER duplicate type/interface definitions** - always import from a central location
- Each feature should have a `*-types.ts` file (e.g., `todo-types.ts`) that exports the canonical Zod schema and inferred type
- When you need a type, import it: `import { Todo, TodoSchema } from "./todo-types"`
- Types derived from Zod schemas ensure schema changes propagate everywhere automatically

**Pattern for feature types:**
```typescript
// todo-types.ts - THE single source of truth
import { z } from "zod";

export const TodoSchema = z.object({
    id: z.string(),
    title: z.string(),
    tags: z.array(z.string()).optional(),
    // ... all fields defined HERE
});

export type Todo = z.infer<typeof TodoSchema>;
```

```typescript
// index.ts - Import, don't redefine
import { TodoSchema } from "./todo-types";

export const functionStubs = {
    getTodos: {
        input: z.object({ project: z.string().optional() }),
        output: z.array(TodoSchema),  // Reuse the schema
    },
};
```

```typescript
// GOOD: Import from central location
import { Todo } from "./todo-types";

// BAD: Duplicate interface/schema definition
const TodoSchema = z.object({  // This WILL drift out of sync!
    id: z.string(),
    title: z.string(),
    // Missing fields = bugs
});
```

**Why this matters:** Duplicated schemas cause silent bugs. If you add a field to one schema but not the duplicate, data gets silently dropped during validation or serialization.

### File Operations
- Use `Bun.file()` for file operations, not Node.js fs
- Use `Bun.$` for shell commands, not execa
- Use `Bun.serve()` for HTTP server, not express

### UI Development
- NEVER add props/fields without explicit user request
- Keep UI minimal - less is more
- Make interfaces self-discoverable with visual keyboard hints
- Use theme system for styling over inline styles/Tailwind

### Build Validation
- Run `bun run build` after EVERY change
- This runs: Tailwind CSS build + ESLint + TypeScript checking
- NEVER use `tsc` or `eslint` commands directly

## MacOS Styling

### Tab Key Navigation in WKWebView
WKWebView (used by the native Mac app) doesn't forward Tab key events properly to the web content. The solution:

1. **Global keyboard bridge** (`useNativeKeyboardBridge` in `src/hooks/useNativeKeyboardBridge.ts`):
   - Registers global functions (`__nativeFocusNext`, `__nativeFocusPrevious`) that Swift calls
   - These functions manually find and focus the next/previous focusable element
   - Already initialized at the app root level - no action needed for new components

2. **Cmd+Enter handling** (`useNativeSubmit`):
   - Use this hook in dialogs/forms that need submit on Cmd+Enter
   ```tsx
   import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";

   useNativeSubmit(() => {
       if (isValid && !loading) {
           handleSubmit();
       }
   });
   ```

### Focus Indicators
When building interactive buttons or triggers (especially for popovers/dialogs), always add proper focus ring styles for keyboard navigation accessibility:

```tsx
<button
    className="... focus:outline-none focus:ring-2 focus:ring-offset-1"
>
```

This ensures:
- `focus:outline-none` - Removes default browser outline
- `focus:ring-2` - Adds a 2px ring on focus
- `focus:ring-offset-1` - Adds slight offset from the element

This is especially important for the native Mac app where keyboard navigation relies on the bridge.

### Dialog Focus Management
For dialogs with action buttons (Cancel, Submit, etc.):

1. **Remove X button from tab order**: The dialog close X button has `tabIndex={-1}` in `dialog.tsx` so it doesn't interfere with keyboard navigation. Users can still click it.

2. **Auto-focus the first action button**: Add `autoFocus` to the Cancel or first button so focus starts there when the dialog opens:
   ```tsx
   <Button variant="ghost" onClick={handleCancel} autoFocus>
       Cancel
   </Button>
   ```

3. **Add Cmd+Enter microtext**: Show users the keyboard shortcut under primary action buttons:
   ```tsx
   <div className="flex flex-col items-center">
       <Button onClick={handleConfirm}>Confirm</Button>
       <span className="text-[10px] text-muted-foreground mt-1">⌘ Enter</span>
   </div>
   ```

4. **Handle Cmd+Enter**: Use `useNativeSubmit` hook for the submit action (see Cmd+Enter handling above).

### Multi-Tab Form Submission
When multiple chat tabs are open, each `ProseMirrorPromptTextarea` must submit to its own parent form, not just the first form in the DOM. The fix:

- `ProseMirrorPromptContext` exposes a `formRef` pointing to the parent `<form>` element
- `ProseMirrorPromptTextarea.handleSubmit` uses `context?.formRef.current` instead of `document.querySelector("form")`

This ensures CMD+Enter in any focused chat input submits to the correct tab's form.

## Project-Specific Rules

- Use `bun` for all package management and script execution
- For Python scripts: use `uv run script.py`
- Never create documentation files unless explicitly requested
- Focus on exact scope requested - no "improvements" without permission
