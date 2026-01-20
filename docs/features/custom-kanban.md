# Custom Kanban Board

Flexible Kanban columns for project-based todo management. Separate task lifecycle (done/todo) from board position.

## Overview

The custom Kanban feature allows each project to have its own column configuration, independent of the default status-based columns. Key benefits:

- **Custom Columns**: Create columns like "This Week", "Today", "Backlog" instead of fixed statuses
- **Status Mapping**: Each column can optionally auto-set a status when todos are moved there
- **Hybrid State**: A todo can be `status: done` (checked ✓) while remaining in "This Week" column

## Key Concept

```
Before: status = column position
        todo → "To Do" column
        done → "Done" column

After:  status ≠ column position
        status = lifecycle state (done/todo)
        customColumnId = board position
```

## Data Model

### BoardColumn

```typescript
interface BoardColumn {
    id: string;           // Unique identifier (e.g., "col-this-week")
    title: string;        // Display name (e.g., "This Week")
    order: number;        // Position left-to-right (1, 2, 3...)
    status?: "todo" | "in_progress" | "done" | "later";  // Auto-set on drop
}
```

### BoardConfig

```typescript
interface BoardConfig {
    id: string;           // FileDatabase ID
    projectId: string;    // Project name ("" = no project)
    columns: BoardColumn[];
    showDone: boolean;    // Future: hide completed items
}
```

### Todo Extension

```typescript
// Added to TodoSchema
customColumnId?: string;  // ID from BoardConfig.columns
```

## Storage

| File | Purpose |
|------|---------|
| `{workspace}/noetic-data/board-configs/*.json` | Per-project board configs |
| `{workspace}/noetic-data/todos/*.json` | Todos with `customColumnId` field |

## UI Components

### Board Settings Dialog

Accessed via project dropdown menu → "Setup Custom Board" or "Board Settings".

Features:
- Add/remove/rename columns
- Set auto-status per column
- Drag to reorder (future)

### Kanban View Modes

| Context | Behavior |
|---------|----------|
| Project with config | Custom columns from BoardConfig |
| Project without config | Legacy status columns (todo/in_progress/done) |
| All Projects / No Project | Legacy status columns |

## Fallback Logic

When a todo doesn't have `customColumnId`, it's mapped using fallback:

```typescript
function getColumnForTodo(todo: Todo): string {
    if (boardConfig && todo.customColumnId) {
        return todo.customColumnId;
    }
    if (todo.status === "done") {
        return lastColumn.id;  // Last column
    }
    return firstColumn.id;     // First column
}
```

## API Endpoints

### Get Board Config

```
POST /api/todos/board-config/get
Body: { "projectId": "My Project" }
Response: BoardConfig | null
```

### Save Board Config

```
POST /api/todos/board-config/save
Body: { "config": BoardConfig }
Response: BoardConfig
```

### Delete Column

Moves orphaned todos to first remaining column.

```
POST /api/todos/column/delete
Body: { "projectId": "My Project", "columnId": "col-old" }
Response: { "success": true }
```

## Status Auto-Assignment

When a column has a `status` field set, moving a todo to that column automatically updates the todo's status:

| Action | Result |
|--------|--------|
| Drag to column with `status: "done"` | Todo gets `status: done` |
| Drag to column without status | Status unchanged |
| Toggle checkbox | Status toggles between done/todo |

This enables workflows like:
- "Done" column marks items complete
- "Archive" column could set `status: done` for archiving

## File Structure

```
bun-sidecar/src/features/todos/
├── board-types.ts           # BoardColumn, BoardConfig schemas
├── fx.ts                    # Backend: getBoardConfig, saveBoardConfig, deleteColumn
├── index.ts                 # Function stubs
├── browser-view.tsx         # Kanban UI with custom column support
├── BoardSettingsDialog.tsx  # Column management UI
└── TodoCard.tsx             # Card with toggle checkbox

bun-sidecar/src/server-routes/
└── todos-routes.ts          # API endpoints

bun-sidecar/src/hooks/
└── useTodosAPI.ts           # Frontend API methods
```

## Default Columns

When creating a new custom board, these columns are pre-configured:

| Column | Status | Purpose |
|--------|--------|---------|
| Backlog | todo | Items to do eventually |
| This Week | in_progress | Current sprint items |
| Today | in_progress | Today's focus |
| Done | done | Completed items |
