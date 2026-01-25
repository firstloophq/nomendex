---
name: ui-design
description: Design patterns and component guidelines for the Nomendex UI. Use when building dialogs, layouts, or fixing visual/layout issues.
---

# UI Design Patterns

Reference documentation for consistent UI patterns in Nomendex.

## Jumbo Dialogs

Jumbo dialogs (size="jumbo") are full-viewport dialogs (90vw x 90vh) for complex content like search interfaces, file browsers, or multi-pane layouts.

### Structure Requirements

The jumbo dialog uses `display: flex` with `flex-direction: column`. The `CommandDialogProvider` automatically wraps content in a flex-growing container when `size="jumbo"`:

```tsx
// CommandDialogProvider handles this automatically for jumbo dialogs:
<DialogContent size="jumbo">
    <DialogHeader className="shrink-0">
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
    </DialogHeader>

    {/* Content is auto-wrapped in: <div className="flex-1 min-h-0 flex flex-col"> */}
    {dialogState.content}
</DialogContent>
```

### Key CSS Classes

- `shrink-0` - Prevents header from shrinking
- `flex-1` - Allows content to grow and fill space
- `min-h-0` - Critical for flex children to allow shrinking below content size (enables overflow)
- `overflow-y-auto` - For scrollable sections

### Why min-h-0 Matters

In flexbox, children have `min-height: auto` by default, which means they won't shrink below their content size. This breaks overflow scrolling. Adding `min-h-0` allows the element to shrink, enabling `overflow-y-auto` to work.

## Reference Implementation: Search Notes Dialog

Located at `src/features/notes/search-notes-dialog.tsx`, this demonstrates the full pattern.

### Opening via CommandDialogProvider

```tsx
openDialog({
    title: "Search Notes",
    description: "Search for text across all your notes",
    content: <SearchNotesDialog />,
    size: "jumbo",
});
```

### Two-Column Layout Pattern

```tsx
<div className="flex flex-col h-full">
    {/* Fixed top section - search input */}
    <div
        className="shrink-0 px-4 py-3 border-b"
        style={{ borderColor: styles.borderDefault }}
    >
        <Input placeholder="Search notes..." />
    </div>

    {/* Two-column scrollable area */}
    <div className="flex-1 flex min-h-0">
        {/* Left column - results list */}
        <div
            className="w-1/2 overflow-y-auto border-r"
            style={{ borderColor: styles.borderDefault }}
        >
            {/* Results items */}
        </div>

        {/* Right column - preview */}
        <div
            className="w-1/2 overflow-y-auto"
            style={{ backgroundColor: styles.surfacePrimary }}
        >
            {/* Preview content */}
        </div>
    </div>
</div>
```

### Theme-Aware Highlights

Use theme system colors for search highlights:

```tsx
import { useTheme } from "@/hooks/useTheme";

const { currentTheme } = useTheme();
const { styles } = currentTheme;

// For inline text highlights (search matches)
<mark
    style={{
        backgroundColor: styles.semanticPrimary,
        color: styles.semanticPrimaryForeground,
        borderRadius: "2px",
        padding: "0 2px",
    }}
>
    {matchedText}
</mark>

// For line/row highlights (match context)
<div
    style={{
        backgroundColor: isMatchLine ? styles.surfaceAccent : "transparent",
    }}
>
    {lineContent}
</div>
```

### Available Theme Colors

From `useTheme().currentTheme.styles`:

**Surfaces (backgrounds):**
- `surfacePrimary` - Main background
- `surfaceSecondary` - Secondary/elevated background
- `surfaceTertiary` - Hover states, selected items
- `surfaceAccent` - Accent/highlight backgrounds
- `surfaceMuted` - Muted backgrounds

**Content (text):**
- `contentPrimary` - Main text
- `contentSecondary` - Secondary text
- `contentTertiary` - Muted/disabled text
- `contentAccent` - Accent text

**Borders:**
- `borderDefault` - Standard borders
- `borderAccent` - Accent borders

**Semantic (actions/status):**
- `semanticPrimary` / `semanticPrimaryForeground` - Primary actions, highlights
- `semanticDestructive` / `semanticDestructiveForeground` - Delete, danger
- `semanticSuccess` / `semanticSuccessForeground` - Success states

### Keyboard Navigation

Implement arrow key navigation for lists:

```tsx
const [selectedIndex, setSelectedIndex] = React.useState(0);

React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % results.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            // Open selected item
        } else if (e.key === "Escape") {
            e.preventDefault();
            closeDialog();
        }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
}, [results, selectedIndex]);
```

### Auto-scroll Selected Item Into View

```tsx
const resultsContainerRef = React.useRef<HTMLDivElement>(null);

React.useEffect(() => {
    if (resultsContainerRef.current && results.length > 0) {
        const selectedElement = resultsContainerRef.current.querySelector(
            `[data-index="${selectedIndex}"]`
        );
        if (selectedElement) {
            selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }
}, [selectedIndex, results.length]);

// In JSX:
<div ref={resultsContainerRef}>
    {results.map((result, index) => (
        <div key={result.id} data-index={index}>
            {/* ... */}
        </div>
    ))}
</div>
```

### Scroll-to-Line on Note Open

When opening a note from search results, scroll to the first match:

```tsx
// In search dialog - pass scrollToLine when opening
const openNote = (fileName: string, scrollToLine?: number) => {
    addNewTab({
        pluginMeta: notesPluginSerial,
        view: "editor",
        props: { noteFileName: fileName, scrollToLine }
    });
};

// Get first content match line
const contentMatches = result.matches.filter(m => m.line > 0);
const firstMatchLine = contentMatches.length > 0 ? contentMatches[0].line : undefined;
openNote(result.fileName, firstMatchLine);
```

The `NotesView` component accepts `scrollToLine` prop and scrolls the ProseMirror editor to that line on initial load.
