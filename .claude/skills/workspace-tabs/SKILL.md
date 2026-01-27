---
name: workspace-tabs
description: Guide for working with workspace tabs, tab management, and duplicate tab prevention. Use when fixing tab bugs, adding tab features, or working with openTab/addNewTab functions.
---

# Workspace Tabs

This skill covers the workspace tab system in Nomendex, including how tabs are created, managed, and how duplicate detection works.

## Key Files

- `src/hooks/useWorkspace.tsx` - Core tab management logic
- `src/components/NotesCommandMenu.tsx` - CMD+P quick file opener
- `src/contexts/WorkspaceContext.tsx` - Provides workspace functions to components
- `src/types/Workspace.ts` - Tab and workspace type definitions

## Tab Creation Functions

### `addNewTab()` - Always Creates New Tab

```typescript
addNewTab({ pluginMeta, view, props })
```

- **Always** creates a new tab, even if identical tab exists
- Does NOT set the new tab as active
- Use only when you explicitly want duplicates allowed

### `openTab()` - Smart Tab Opening (Preferred)

```typescript
openTab({ pluginMeta, view, props })
```

- Checks for existing matching tab first
- If match found: focuses existing tab (no duplicate)
- If no match: creates new tab and sets it active
- **Always use this** unless you have a specific reason for duplicates

## Duplicate Detection Logic

`openTab()` matches tabs based on:

1. **Plugin ID** - Must match (e.g., "notes", "todos", "chat")
2. **View ID** - Must match (e.g., "editor", "browser", "kanban")
3. **Props** - Depends on plugin type:

| Plugin | Props Matched |
|--------|---------------|
| notes | `noteFileName` |
| todos | `project` (for browser/kanban views) |
| tags | `tagName` |
| others | Empty props match empty props |

## Critical: Stale Closure Bug

The duplicate check MUST happen inside the `updateWorkspace` callback to access latest state:

```typescript
// WRONG - uses stale closure, won't detect recent tabs
const openTab = useCallback(({ pluginMeta, view, props }) => {
    const existingTab = workspace.tabs.find(tab => /* ... */);  // STALE!
    if (existingTab) {
        updateWorkspace({ activeTabId: existingTab.id });
        return existingTab;
    }
    // ...
}, [workspace.tabs]);  // Even with dependency, still stale between renders

// CORRECT - uses prev.tabs from callback for latest state
const openTab = useCallback(({ pluginMeta, view, props }) => {
    let resultTab = null;
    updateWorkspace((prev) => {
        const existingTab = prev.tabs.find(tab => /* ... */);  // FRESH!
        if (existingTab) {
            resultTab = existingTab;
            return { ...prev, activeTabId: existingTab.id };
        }
        // Create new tab...
        resultTab = newTab;
        return { ...prev, tabs: [...prev.tabs, newTab], activeTabId: newTab.id };
    });
    return resultTab;
}, [createPluginInstance, updateWorkspace]);
```

## Common Patterns

### Opening a Note from UI

```typescript
const { openTab } = useWorkspaceContext();

openTab({
    pluginMeta: notesPluginSerial,
    view: "editor",
    props: { noteFileName: "my-note.md" },
});
```

### Opening Todos Browser

```typescript
openTab({
    pluginMeta: todosPluginSerial,
    view: "browser",
    props: { project: "work" },
});
```

### Opening Chat

```typescript
openTab({
    pluginMeta: chatPluginSerial,
    view: "default",
    props: {},
});
```

## Debugging Tab Issues

1. Check if code uses `addNewTab` vs `openTab`
2. If using `openTab`, verify the duplicate check uses `prev.tabs` not `workspace.tabs`
3. Add console logs inside the `updateWorkspace` callback to see actual tab state
4. Check that props being matched are correct (e.g., `noteFileName` not `noteId`)

## WorkspaceTab Structure

```typescript
interface WorkspaceTab {
    id: string;                    // Unique tab ID
    title: string;                 // Display title
    pluginInstance: {
        instanceId: string;
        plugin: SerializablePlugin;
        instanceProps: Record<string, unknown>;
        viewId: string;
    };
}
```
