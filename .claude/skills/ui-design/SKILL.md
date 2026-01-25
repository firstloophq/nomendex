---
name: ui-design
description: Design patterns and component guidelines for the Nomendex UI. Use when building dialogs, layouts, or fixing visual/layout issues.
---

# UI Design Patterns

Reference documentation for consistent UI patterns in Nomendex.

## Jumbo Dialogs

Jumbo dialogs (size="jumbo") are full-viewport dialogs (90vw x 90vh) for complex content like search interfaces, file browsers, or multi-pane layouts.

### Structure Requirements

The dialog content uses CSS Grid with `gap-4`. For content to fill the available height, you must structure it properly:

```tsx
<DialogContent size="jumbo">
    <DialogHeader className="shrink-0">
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
    </DialogHeader>

    {/* Content wrapper MUST have flex-1 and min-h-0 to fill remaining space */}
    <div className="flex-1 min-h-0 flex flex-col">
        {/* Your content here */}
    </div>
</DialogContent>
```

### Key CSS Classes

- `shrink-0` - Prevents header from shrinking
- `flex-1` - Allows content to grow and fill space
- `min-h-0` - Critical for flex children to allow shrinking below content size (enables overflow)
- `overflow-y-auto` - For scrollable sections

### Common Pattern: Two-Column Layout

```tsx
<div className="flex-1 min-h-0 flex flex-col">
    {/* Fixed top section (e.g., search input) */}
    <div className="shrink-0 p-4 border-b">
        <Input placeholder="Search..." />
    </div>

    {/* Two-column scrollable area */}
    <div className="flex-1 flex min-h-0">
        {/* Left column - list */}
        <div className="w-1/2 overflow-y-auto border-r">
            {/* Results list */}
        </div>

        {/* Right column - preview */}
        <div className="w-1/2 overflow-y-auto">
            {/* Preview content */}
        </div>
    </div>
</div>
```

### Why min-h-0 Matters

In flexbox, children have `min-height: auto` by default, which means they won't shrink below their content size. This breaks overflow scrolling. Adding `min-h-0` allows the element to shrink, enabling `overflow-y-auto` to work.

### DialogContent Grid Layout

The DialogContent component uses `display: grid` with `gap-4`. When using jumbo size, the content should span the full grid area. The dialog internally handles:
- Header (shrink to fit)
- Content (fill remaining space)
- Close button (absolute positioned)
