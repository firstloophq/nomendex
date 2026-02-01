# Projects Structure and Functionality

This document describes the technical design and functionality of projects within the application. Projects serve as the main container for organizing work, grouping both tasks (Todos) and the knowledge base (Notes).

## Core Concepts

There is an important duality in the system regarding what constitutes a "Project":

1.  **Project as a Tag:**
    *   Used for standard task filtering.
    *   Stored directly on the todo item as `project: "project-name"`.
    *   Allows for flexible workflows without requiring configuration.

2.  **Project as an Entity (ProjectConfig):**
    *   Enables advanced features (e.g., custom Kanban columns).
    *   Defined in `projects.json` at the workspace root.
    *   Contains project metadata (name, description, ID) and board configuration.

---

## 1. Projects and Kanban

A Project is not the same as a Kanban board. **The Project is the container**, while **Kanban is a view** of the tasks within that container.

### Board Modes

The application automatically switches between two display modes depending on whether the project has a configuration:

#### A. Default (Legacy) Mode
If a project has no entry in `projects.json`, a standard set of columns derived directly from the task status is used:
*   **To Do** (`status: "todo"`)
*   **In Progress** (`status: "in_progress"`)
*   **Done** (`status: "done"`)
*   **Later** (`status: "later"`) - optionally hidden.

#### B. Custom Mode
If a project is defined in `projects.json` and has `board.columns` set, the custom mode is activated.
*   Columns are defined by the configuration (each has its own ID).
*   Tasks are sorted into columns primarily by the `customColumnId` property.
*   **Status Synchronization:** The system attempts to map columns to statuses (`todo`, `done`, etc.) so that global overviews (e.g., "what is done") function correctly even within a custom board.

---

## 2. Projects and Notes

Notes are more loosely associated with projects than tasks are.

*   **Association:** A note belongs to a project if its header (YAML frontmatter) contains the `project` field.
    ```yaml
    ---
    project: MyProject
    ---
    ```
*   **Editing:** The project is assigned directly in the note editor (`ProjectInput` component).
*   **Display:** In the project detail view (`ProjectDetailView`), all notes containing the matching project name in their frontmatter are automatically loaded.

## 3. Projects and Todos

Tasks (Todos) are "first-class citizens" within projects.
*   **Link:** Todos hold a reference to the project in the `project` field.
*   **API:** The `/api/todos/projects` endpoint returns a list of all used project names (from all tasks), serving as a source for the autocomplete feature.

---

## 4. Technical Details and Data Model

### Schema Architecture

Types are defined in `project-types.ts` (single source of truth):

```
project-types.ts
├── BoardColumnSchema    
├── BoardConfigSchema    
├── ProjectConfigSchema (includes optional board)
└── getDefaultColumns()
```

### Data Model

#### BoardColumn
```typescript
interface BoardColumn {
    id: string;           // Unique identifier (e.g., "col-this-week")
    title: string;        // Display name
    order: number;        // Order from left to right (1, 2, 3...)
    status?: "todo" | "in_progress" | "done" | "later";  // Auto-set on drop
}
```

#### BoardConfig (embedded in ProjectConfig)
```typescript
interface BoardConfig {
    columns: BoardColumn[];
    showDone: boolean;    // Hide completed items (default: true)
}
```

#### ProjectConfig (`projects.json`)
```typescript
interface ProjectConfig {
    id: string;           // "proj-abc123"
    name: string;         // "Nomendex"
    description?: string;
    color?: string;
    archived?: boolean;
    board?: BoardConfig;  // Embedded board configuration
    createdAt: string;
    updatedAt: string;
}
```

#### Todo Extension
```typescript
// Added to TodoSchema
customColumnId?: string;  // Column ID from BoardConfig.columns
```

### "Before and After" Logic
Difference in understanding task positioning:

*   **Legacy Mode:** `status` determines the column (todo → "To Do").
*   **Custom Mode:** `customColumnId` determines the column, `status` represents only the lifecycle state (done/not done).

### API Endpoints

Board configuration is part of the Project entity.

*   **List Projects:** `POST /api/projects/list` `{}`
*   **Get Project by ID:** `POST /api/projects/get` `{ "projectId": "proj-123" }`
*   **Get Project by Name:** `POST /api/projects/get-by-name` `{ "name": "My Project" }`
*   **Update Project:** `POST /api/projects/update` `{ "projectId": "...", "updates": {...} }`
*   **Get Board Config:** `POST /api/projects/board/get` `{ "projectId": "proj-123" }`
*   **Save Board Config:** `POST /api/projects/board/save` `{ "projectId": "...", "board": BoardConfig }`
*   **Delete Project:** `POST /api/projects/delete` `{ "projectId": "proj-123" }`

### Default Columns for New Boards

When a user creates a custom board, these columns are pre-configured:

| Column | Status Mapping | Purpose |
| :--- | :--- | :--- |
| **To Do** | `todo` | Default todo list |
| **In Progress** | `in_progress` | Currently working on |
| **Done** | `done` | Completed items |
| **Later** | `later` | Deferred items |

## Model Summary

| Entity | Data Storage | Link to Project |
| :--- | :--- | :--- |
| **Project Config** | `projects.json` | Definition of the project itself |
| **Todo** | SQLite / JSON files | `project` field (string) |
| **Note** | Markdown files | `project` frontmatter (string) |

This decentralized architecture (where tasks and notes "point" to the project, rather than the project "owning" a list of IDs) allows for high flexibility and resilience against synchronization errors.
