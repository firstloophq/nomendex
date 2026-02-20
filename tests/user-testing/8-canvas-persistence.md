# 8 - Canvas Persistence

Prompt:
- Use one browser tab on `/canvas-test`.
- Add query params:
- `canvasId=<existing-id>` if you already have a test canvas, otherwise omit `canvasId` on first load and copy the generated id shown in the page header.
- `marker=<unique-marker>` (example: `marker=persist-001`).
- Confirm `mode` is `local` and `sync` is `synced`.
- Click `Clear` so `shapes` becomes `0`.
- Click `Add marker shape` once so `shapes` becomes `1` and `texts` includes your marker.
- Take a screenshot (`before reopen`).
- Close the tab.
- Reopen the same `/canvas-test?...` URL with the same `canvasId` and `marker`.
- Verify `shapes` is still `1` and `texts` still includes the same marker.
- Take a screenshot (`after reopen`).
- Compare both screenshots and UI counters.
- Mark PASS only if the reopened canvas still shows the same saved state.
