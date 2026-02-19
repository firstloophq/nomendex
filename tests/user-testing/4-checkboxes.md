# 4 - Checkboxes ([] / Cmd+Enter / Enter behavior)

Prompt:
- Click Clear all and refresh both tabs so we start fresh.
- Open two browser tabs on the same `/collab-test` doc with distinct users/client IDs.
- In the active page type one key per stroke:
  - `- [ ] Task one`
- Press `Cmd+Enter` once on that line to toggle checkbox state.
- Press `Enter` while line has content to create a new checkbox line below.
- On the new checkbox line, leave it empty and press `Enter` again.
- Wait for sync.
- Take screenshots of both pages.
- Compare output.
- Verify:
  - checkbox exists
  - Cmd+Enter toggled the checkbox
  - Enter on non-empty checkbox created a new checkbox line
  - Enter on empty checkbox removed line content/checkbox continuation
  - both editors match
