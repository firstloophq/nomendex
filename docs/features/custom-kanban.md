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

Now embedded directly within the Project configuration.

```typescript
interface BoardConfig {
    columns: BoardColumn[];
    showDone: boolean;    // Hide completed items
}
```

### ProjectConfig

```typescript
interface ProjectConfig {
    id: string;           // "proj-abc123"
    name: string;         // "Nomendex"
    description?: string;
    board?: BoardConfig;  // Embedded board configuration
    createdAt: string;
    updatedAt: string;
}
```

### Todo Extension

```typescript
// Added to TodoSchema
customColumnId?: string;  // ID from ProjectConfig.board.columns
```

## Storage

| File | Purpose |
|------|---------|
| `{workspace}/.nomendex/projects.json` | Centralized file for all projects and their board configs |
| `{workspace}/noetic-data/todos/*.json` | Todos with `customColumnId` field |

## UI Components

### Board Settings Dialog

Accessed via project dropdown menu → "Setup Custom Board" or "Board Settings".

Features:
- Add/remove/rename columns
- Set auto-status per column
- Drag to reorder

## API Endpoints

Board configuration is now part of the Project entity. To change the board, you update the project.

### Get Project (by name or ID)

```
POST /api/projects/get-by-name
Body: { "name": "My Project" }
Response: ProjectConfig | null
```

```
POST /api/projects/get
Body: { "projectId": "proj-123" }
Response: ProjectConfig | null
```

### Get Board Config

```
POST /api/projects/board/get
Body: { "projectId": "proj-123" }
Response: BoardConfig | null
```

### Save Board Config

```
POST /api/projects/board/save
Body: { "projectId": "proj-123", "board": BoardConfig }
Response: ProjectConfig
```

### Delete Project

```
POST /api/projects/delete
Body: { "id": "proj-123" }
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
bun-sidecar/src/features/projects/
├── project-types.ts         # ProjectConfig, BoardConfig, BoardColumn schemas
├── fx.ts                    # Backend: listProjects, getProject, saveBoardConfig
├── index.ts                 # Plugin definition
├── project-detail-view.tsx  # Kanban UI with custom column support
└── CreateProjectDialog.tsx  # Project creation UI
```

## Default Columns

When creating a new custom board, these columns are pre-configured:

| Column | Status | Purpose |
|--------|--------|---------|
| Backlog | todo | Items to do eventually |
| This Week | in_progress | Current sprint items |
| Today | in_progress | Today's focus |
| Done | done | Completed items |
