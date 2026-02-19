# CRDT Issue: `localsInner` crash when typing checkbox trigger (`[] `)

## Summary
In collab mode, typing checkbox trigger text causes a ProseMirror runtime crash:

`TypeError: Cannot read properties of undefined (reading 'localsInner')`

The crash appears in ProseMirror decoration rendering (`DecorationGroup.locals`) and is reproducible via normal typing.

## Repro
1. Open collab editor page, e.g.:
   - `http://localhost:1234/collab-test?doc=<id>&userId=user-a&crdtClientId=<id>-a`
2. Focus the editor.
3. Type `[]` then space.
4. Observe runtime error in console (`localsInner`).

Also reproducible with explicit todo text typing:
- `- [ ] `

## Observed stack (from browser)
- `DecorationGroup.locals`
- `iterDeco`
- `NodeViewDesc.updateChildren`
- `EditorView.updateStateInner`
- `DOMObserver.flush`

## Isolation result
Disabling the CRDT cursor decoration plugin in collab mode removes the crash entirely.

Local workaround currently applied:
- `bun-sidecar/src/features/notes/note-view.tsx`
- Collab plugin list excludes `cursorPlugin`.

With this workaround:
- `[] ` converts to todo checkbox markup
- no `localsInner` runtime crash
- cross-tab content sync still works

## Likely CRDT-side fix target
Investigate cursor-decoration integration in collab mode for invalid decoration entries during DOM flush/update.

Relevant CRDT source:
- `crdt/src/crdt/prosemirror/cursor-decorations.ts`

## Notes
This is treated as a CRDT library issue because app-level todo decorations can remain enabled and stable once CRDT cursor decorations are removed.
