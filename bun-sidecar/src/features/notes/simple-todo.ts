import { keymap } from "prosemirror-keymap";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import {
  Command,
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { Node as PMNode, ResolvedPos } from "prosemirror-model";

// Match todo in a standalone paragraph: "- [ ] text" or "- [x] text"
const TODO_REGEX = /^(\s*)- \[([ xX])\] ?(.*)$/;
// Match todo inside a list_item's paragraph: "[ ] text" or "[x] text" (no leading "- ")
const LIST_TODO_REGEX = /^\[([ xX])\] ?(.*)$/;
const BULLET_REGEX = /^(\s*)- (.*)$/;
const TRIGGER_REGEX = /^(\s*)(-\s*)?\[\]$/;
const TODO_MARKER_TEMPLATE = "- [ ] ";
const TODO_MARKER_LENGTH = TODO_MARKER_TEMPLATE.length;
// Match empty todo: just "- [ ] " with nothing after (or only whitespace)
const EMPTY_TODO_REGEX = /^(\s*)- \[([ xX])\]\s*$/;
// Match empty list todo: just "[ ] " with nothing after (in list item)
const EMPTY_LIST_TODO_REGEX = /^\[([ xX])\]\s*$/;

interface ParagraphRange {
  lineStart: number;
  lineEnd: number;
}

interface SelectionOffsets {
  anchor: number;
  head: number;
}

const todoPluginKey = new PluginKey<DecorationSet>("simpleTodoPlugin");

function resolveParagraphRange($pos: ResolvedPos): ParagraphRange | null {
  const parent = $pos.parent;

  if (!parent || parent.type.name !== "paragraph") {
    return null;
  }

  return {
    lineStart: $pos.start($pos.depth),
    lineEnd: $pos.end($pos.depth),
  };
}

function computeTodoReplacement(lineText: string): string | null {
  // Check for standalone paragraph todo: "- [ ] text"
  const todoMatch = lineText.match(TODO_REGEX);
  if (todoMatch) {
    const [, indent, checked, text] = todoMatch;
    const newChecked = (checked || "").trim().toLowerCase() === "x" ? " " : "x";
    return `${indent}- [${newChecked}] ${text}`;
  }

  // Check for list item todo: "[ ] text" (inside a list_item)
  const listTodoMatch = lineText.match(LIST_TODO_REGEX);
  if (listTodoMatch) {
    const [, checked, text] = listTodoMatch;
    const newChecked = (checked || "").trim().toLowerCase() === "x" ? " " : "x";
    return `[${newChecked}] ${text}`;
  }

  const bulletMatch = lineText.match(BULLET_REGEX);
  if (bulletMatch) {
    const [, indent, text] = bulletMatch;
    return `${indent}- [ ] ${text}`;
  }

  const trimmedText = lineText.trim();
  if (!trimmedText) {
    return null;
  }

  const indent = (lineText.match(/^(\s*)/) ?? ["", ""])[1];

  if (trimmedText === "[]") {
    return `${indent}- [ ] `;
  }

  return `${indent}- [ ] ${trimmedText}`;
}

function clampOffset(offset: number, max: number): number {
  if (offset < 0) {
    return 0;
  }
  if (offset > max) {
    return max;
  }
  return offset;
}

function toggleTodoWithinRange(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  range: ParagraphRange,
  selectionOffsets?: SelectionOffsets,
): boolean {
  const lineText = state.doc.textBetween(range.lineStart, range.lineEnd);
  const replacement = computeTodoReplacement(lineText);

  if (!replacement) {
    return false;
  }

  let transaction = state.tr.replaceWith(
    range.lineStart,
    range.lineEnd,
    state.schema.text(replacement),
  );

  if (selectionOffsets) {
    const maxOffset = replacement.length;
    const anchorPos = range.lineStart + clampOffset(selectionOffsets.anchor, maxOffset);
    const headPos = range.lineStart + clampOffset(selectionOffsets.head, maxOffset);
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, anchorPos, headPos));
  }

  if (dispatch) {
    dispatch(transaction);
  }

  return true;
}

export const toggleTodoAtLine: Command = (state, dispatch) => {
  const { selection } = state;

  if (!selection.$from.sameParent(selection.$to)) {
    return false;
  }

  const paragraphRange = resolveParagraphRange(selection.$from);
  if (!paragraphRange) {
    return false;
  }

  const offsets: SelectionOffsets = {
    anchor: selection.anchor - paragraphRange.lineStart,
    head: selection.head - paragraphRange.lineStart,
  };

  return toggleTodoWithinRange(state, dispatch, paragraphRange, offsets);
};

/**
 * Handle Backspace key on todo lines:
 * - If cursor is at the start of todo content (right after "- [ ] "), remove the marker
 */
export const handleTodoBackspace: Command = (state, dispatch) => {
  const { selection } = state;

  // Only handle collapsed selections (cursor, not range)
  if (!selection.empty) {
    return false;
  }

  const $from = selection.$from;

  // Must be in a paragraph
  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const paragraphRange = resolveParagraphRange($from);
  if (!paragraphRange) {
    return false;
  }

  const lineText = state.doc.textBetween(paragraphRange.lineStart, paragraphRange.lineEnd);

  // Check if this is a todo line
  const todoMatch = lineText.match(TODO_REGEX);
  if (!todoMatch) {
    return false;
  }

  const indent = todoMatch[1] ?? "";
  const contentText = todoMatch[3] ?? "";

  // Calculate cursor position relative to line start
  const cursorOffsetInLine = selection.from - paragraphRange.lineStart;

  // Calculate actual marker length: "- [ ]" is 5 chars, plus optional trailing space
  const hasTrailingSpace = lineText.charAt(indent.length + 5) === " ";
  const actualMarkerLength = hasTrailingSpace ? 6 : 5;
  const contentStartOffset = indent.length + actualMarkerLength;

  // Only handle backspace if cursor is at the very start of the content
  if (cursorOffsetInLine !== contentStartOffset) {
    return false;
  }

  if (dispatch) {
    // Replace the todo line with just the content (removing "- [ ] " marker)
    const replacement = indent + contentText;
    let tr: Transaction;
    if (replacement) {
      tr = state.tr.replaceWith(
        paragraphRange.lineStart,
        paragraphRange.lineEnd,
        state.schema.text(replacement)
      );
    } else {
      // Empty replacement - just delete the content (ProseMirror doesn't allow empty text nodes)
      tr = state.tr.delete(paragraphRange.lineStart, paragraphRange.lineEnd);
    }
    // Position cursor at the start of the remaining content
    const newCursorPos = paragraphRange.lineStart + indent.length;
    dispatch(tr.setSelection(TextSelection.create(tr.doc, newCursorPos)));
  }

  return true;
};

/**
 * Handle Enter key on todo lines:
 * - If todo has content: create new todo on next line
 * - If todo is empty (just "- [ ] "): remove the checkbox and leave empty line
 */
export const handleTodoEnter: Command = (state, dispatch) => {
  const { selection } = state;

  // Only handle collapsed selections (cursor, not range)
  if (!selection.empty) {
    return false;
  }

  const $from = selection.$from;

  // Must be in a paragraph
  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const paragraphRange = resolveParagraphRange($from);
  if (!paragraphRange) {
    return false;
  }

  const lineText = state.doc.textBetween(paragraphRange.lineStart, paragraphRange.lineEnd);

  // Check if this is an empty standalone todo line
  const emptyMatch = lineText.match(EMPTY_TODO_REGEX);
  if (emptyMatch) {
    // Empty todo - remove the checkbox marker, leave empty line
    if (dispatch) {
      // Delete all content in the paragraph, leaving it empty
      const tr = state.tr.delete(paragraphRange.lineStart, paragraphRange.lineEnd);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, paragraphRange.lineStart)));
    }
    return true;
  }

  // Check if this is an empty list item todo line
  const emptyListMatch = lineText.match(EMPTY_LIST_TODO_REGEX);
  if (emptyListMatch) {
    // Empty list todo - remove the checkbox marker, leave empty line
    if (dispatch) {
      // Delete all content in the paragraph, leaving it empty
      const tr = state.tr.delete(paragraphRange.lineStart, paragraphRange.lineEnd);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, paragraphRange.lineStart)));
    }
    return true;
  }

  // Check if this is a standalone todo line with content (- [ ] text)
  const todoMatch = lineText.match(TODO_REGEX);
  if (todoMatch) {
    if (dispatch) {
      const indent = todoMatch[1] ?? "";
      const cursorOffsetInLine = selection.from - paragraphRange.lineStart;

      // Get the content after the cursor position
      const textAfterCursor = lineText.slice(cursorOffsetInLine);

      // Build the new todo line content
      // Add a space after the marker if no content, so cursor isn't right against checkbox
      const contentAfter = textAfterCursor || " ";
      const newTodoContent = `${indent}- [ ] ${contentAfter}`;

      // Get the paragraph end position (one level up from text position)
      const paragraphEndPos = $from.after($from.depth);

      // Create the new paragraph with todo content
      const newParagraph = state.schema.nodes.paragraph.create(
        null,
        newTodoContent ? state.schema.text(newTodoContent) : null
      );

      let tr = state.tr;

      // First, delete text after cursor in current paragraph
      if (selection.from < paragraphRange.lineEnd) {
        tr = tr.delete(selection.from, paragraphRange.lineEnd);
      }

      // Insert new paragraph after current one
      // After deletion, the paragraph end position might have shifted
      const insertPos = tr.mapping.map(paragraphEndPos);
      tr = tr.insert(insertPos, newParagraph);

      // Position cursor at start of new todo content (after "- [ ] ")
      const newCursorPos = insertPos + 1 + indent.length + TODO_MARKER_LENGTH;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, newCursorPos)));
    }
    return true;
  }

  // Check if this is a list item todo with content ([ ] text)
  const listTodoMatch = lineText.match(LIST_TODO_REGEX);
  if (listTodoMatch) {
    if (dispatch) {
      const cursorOffsetInLine = selection.from - paragraphRange.lineStart;

      // Get the content after the cursor position
      const textAfterCursor = lineText.slice(cursorOffsetInLine);

      // Build the new todo line content for list item
      // Add a space after the marker if no content, so cursor isn't right against checkbox
      const contentAfter = textAfterCursor || " ";
      const newTodoContent = `[ ] ${contentAfter}`;

      // Get the paragraph end position (one level up from text position)
      const paragraphEndPos = $from.after($from.depth);

      // Create the new paragraph with todo content
      const newParagraph = state.schema.nodes.paragraph.create(
        null,
        newTodoContent ? state.schema.text(newTodoContent) : null
      );

      let tr = state.tr;

      // First, delete text after cursor in current paragraph
      if (selection.from < paragraphRange.lineEnd) {
        tr = tr.delete(selection.from, paragraphRange.lineEnd);
      }

      // Insert new paragraph after current one
      // After deletion, the paragraph end position might have shifted
      const insertPos = tr.mapping.map(paragraphEndPos);
      tr = tr.insert(insertPos, newParagraph);

      // Position cursor at start of new todo content (after "[ ] ")
      // For list item todos, the marker is "[ ] " which is 4 characters
      const newCursorPos = insertPos + 1 + 4;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, newCursorPos)));
    }
    return true;
  }

  // Not a todo line, let default Enter behavior handle it
  return false;
};

function createCheckboxWidget(isChecked: boolean): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "todo-checkbox-widget";
  wrapper.dataset.checked = isChecked ? "true" : "false";
  wrapper.setAttribute("role", "checkbox");
  wrapper.setAttribute("aria-checked", isChecked ? "true" : "false");

  const indicator = document.createElement("span");
  indicator.className = "todo-checkbox-indicator";
  indicator.textContent = "✓";
  wrapper.appendChild(indicator);

  return wrapper;
}

function buildTodoDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return;
    }

    const text = node.textBetween(0, node.content.size, undefined, "\n");

    // Try matching standalone paragraph todo first: "- [ ] text"
    const match = text.match(TODO_REGEX);

    if (match) {
      const indentLength = (match[1] ?? "").length;
      const markerStart = pos + 1 + indentLength;
      // Calculate actual marker length: "- [ ]" is 5 chars, plus optional trailing space
      const hasTrailingSpace = text.charAt(indentLength + 5) === " ";
      const contentAfterMarker = text.slice(indentLength + 6);
      // If empty todo (no content after marker), only hide 5 chars to keep space for cursor positioning
      const actualMarkerLength = hasTrailingSpace && !contentAfterMarker.trim() ? 5 : (hasTrailingSpace ? 6 : 5);
      const markerEnd = markerStart + actualMarkerLength;
      const checkedGroup = match[2] ?? " ";
      const isChecked = checkedGroup.trim().toLowerCase() === "x";
      const className = isChecked ? "todo-completed" : "todo-incomplete";

      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `todo-paragraph ${className}`,
          "data-todo-state": isChecked ? "completed" : "incomplete",
        }),
      );

      decorations.push(
        Decoration.inline(
          markerStart,
          markerEnd,
          { class: "todo-marker-hidden" },
          { inclusiveLeft: false, inclusiveRight: false },
        ),
      );

      decorations.push(
        Decoration.widget(markerStart, () => createCheckboxWidget(isChecked), {
          side: -1,
          ignoreSelection: true,
        }),
      );
      return;
    }

    // Try matching list item todo: "[ ] text" (inside a list_item)
    const listMatch = text.match(LIST_TODO_REGEX);

    if (listMatch) {
      const markerStart = pos + 1; // Start right after the paragraph opening
      // Calculate actual marker length: "[ ]" is 3 chars, plus optional trailing space
      const hasTrailingSpace = text.charAt(3) === " ";
      const contentAfterMarker = text.slice(4);
      // If empty todo (no content after marker), only hide 3 chars to keep space for cursor positioning
      const actualMarkerLength = hasTrailingSpace && !contentAfterMarker.trim() ? 3 : (hasTrailingSpace ? 4 : 3);
      const markerEnd = markerStart + actualMarkerLength;
      const checkedGroup = listMatch[1] ?? " ";
      const isChecked = checkedGroup.trim().toLowerCase() === "x";
      const className = isChecked ? "todo-completed" : "todo-incomplete";

      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `todo-paragraph todo-list-item ${className}`,
          "data-todo-state": isChecked ? "completed" : "incomplete",
        }),
      );

      decorations.push(
        Decoration.inline(
          markerStart,
          markerEnd,
          { class: "todo-marker-hidden" },
          { inclusiveLeft: false, inclusiveRight: false },
        ),
      );

      decorations.push(
        Decoration.widget(markerStart, () => createCheckboxWidget(isChecked), {
          side: -1,
          ignoreSelection: true,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function handleTodoClick(view: EditorView, pos: number, event: MouseEvent): boolean {
  if (event.button !== 0) {
    return false;
  }

  const target = event.target as HTMLElement | null;
  if (!target || !target.closest(".todo-checkbox-widget")) {
    return false;
  }

  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const paragraphRange = resolveParagraphRange($pos);

  if (!paragraphRange) {
    return false;
  }

  const text = state.doc.textBetween(paragraphRange.lineStart, paragraphRange.lineEnd);

  // Check for either standalone todo or list item todo
  const match = text.match(TODO_REGEX) || text.match(LIST_TODO_REGEX);

  if (!match) {
    return false;
  }

  event.preventDefault();

  const toggled = toggleTodoWithinRange(state, view.dispatch, paragraphRange);

  if (toggled) {
    view.focus();
  }

  return toggled;
}

function handleTodoInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== " " || from !== to) {
    return false;
  }

  const { state } = view;
  const $from = state.doc.resolve(from);

  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const lineStart = $from.start($from.depth);
  const textBefore = state.doc.textBetween(lineStart, from, undefined, "\n");
  const triggerMatch = textBefore.match(TRIGGER_REGEX);

  if (!triggerMatch) {
    return false;
  }

  const indent = triggerMatch[1] ?? "";
  const replaceFrom = from - textBefore.length;
  // Add extra space after marker so cursor isn't right against checkbox
  const replacement = `${indent}- [ ]  `;
  const endPos = replaceFrom + replacement.length;

  const transaction = state.tr.insertText(replacement, replaceFrom, from);
  const updatedTransaction = transaction.setSelection(
    TextSelection.create(transaction.doc, endPos),
  );
  view.dispatch(updatedTransaction);

  return true;
}

export const todoPlugin = new Plugin({
  key: todoPluginKey,
  state: {
    init: (_, state) => buildTodoDecorations(state.doc),
    apply(tr, decorationSet, _oldState, newState) {
      if (!tr.docChanged) {
        return decorationSet;
      }

      return buildTodoDecorations(newState.doc);
    },
  },
  props: {
    decorations(state) {
      return todoPluginKey.getState(state) ?? null;
    },
    handleClick(view, pos, event) {
      return handleTodoClick(view, pos, event as MouseEvent);
    },
    handleTextInput(view, from, to, text) {
      return handleTodoInput(view, from, to, text);
    },
  },
});

const INDENT_SIZE = 2;

/**
 * Get the previous paragraph's text content (for checking potential parent items)
 */
function getPreviousParagraphText(_state: EditorState, $pos: ResolvedPos): string | null {
  // Find the paragraph node containing our position
  const paragraphDepth = $pos.depth;

  // We need to find the previous sibling paragraph
  // Go up to parent level and look for previous child
  if (paragraphDepth < 1) return null;

  const parentDepth = paragraphDepth - 1;
  const indexInParent = $pos.index(parentDepth);

  if (indexInParent === 0) {
    // This is the first paragraph, no previous sibling
    return null;
  }

  // Get the previous sibling node
  const parent = $pos.node(parentDepth);
  const prevNode = parent.child(indexInParent - 1);

  if (prevNode.type.name !== "paragraph") {
    return null;
  }

  return prevNode.textContent;
}

/**
 * Check if a line can be a parent for indentation
 * A line can be a parent if it's a todo/bullet with same or less indentation
 */
function canBeParent(prevLineText: string, currentIndent: number): boolean {
  const prevTodoMatch = prevLineText.match(TODO_REGEX);
  const prevBulletMatch = prevLineText.match(BULLET_REGEX);

  if (!prevTodoMatch && !prevBulletMatch) {
    return false;
  }

  const prevIndent = (prevTodoMatch?.[1] ?? prevBulletMatch?.[1] ?? "").length;

  // Previous line must have same or less indentation to be a valid parent
  return prevIndent <= currentIndent;
}

/**
 * Handle Tab key to indent todo/bullet lines
 * Only indents if there's a valid parent item above
 */
export const handleTodoIndent: Command = (state, dispatch) => {
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const $from = selection.$from;

  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const paragraphRange = resolveParagraphRange($from);
  if (!paragraphRange) {
    return false;
  }

  const lineText = state.doc.textBetween(paragraphRange.lineStart, paragraphRange.lineEnd);

  // Check if this is a todo or bullet line
  const todoMatch = lineText.match(TODO_REGEX);
  const bulletMatch = lineText.match(BULLET_REGEX);

  if (!todoMatch && !bulletMatch) {
    return false;
  }

  const currentIndent = (todoMatch?.[1] ?? bulletMatch?.[1] ?? "").length;

  // Check if there's a valid parent above
  const prevLineText = getPreviousParagraphText(state, $from);

  if (!prevLineText || !canBeParent(prevLineText, currentIndent)) {
    // No valid parent - don't indent
    return false;
  }

  if (dispatch) {
    // Add indentation at the start of the line
    const indentStr = " ".repeat(INDENT_SIZE);
    const tr = state.tr.insertText(indentStr, paragraphRange.lineStart);

    // Adjust cursor position
    const newCursorPos = selection.from + INDENT_SIZE;
    dispatch(tr.setSelection(TextSelection.create(tr.doc, newCursorPos)));
  }

  return true;
};

/**
 * Handle Shift-Tab to outdent todo/bullet lines
 */
export const handleTodoOutdent: Command = (state, dispatch) => {
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const $from = selection.$from;

  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const paragraphRange = resolveParagraphRange($from);
  if (!paragraphRange) {
    return false;
  }

  const lineText = state.doc.textBetween(paragraphRange.lineStart, paragraphRange.lineEnd);

  // Check if this is a todo or bullet line
  const todoMatch = lineText.match(TODO_REGEX);
  const bulletMatch = lineText.match(BULLET_REGEX);

  if (!todoMatch && !bulletMatch) {
    return false;
  }

  const currentIndent = (todoMatch?.[1] ?? bulletMatch?.[1] ?? "").length;

  if (currentIndent === 0) {
    // No indentation to remove
    return false;
  }

  if (dispatch) {
    // Remove up to INDENT_SIZE spaces from the start
    const spacesToRemove = Math.min(INDENT_SIZE, currentIndent);
    const tr = state.tr.delete(paragraphRange.lineStart, paragraphRange.lineStart + spacesToRemove);

    // Adjust cursor position
    const newCursorPos = Math.max(paragraphRange.lineStart, selection.from - spacesToRemove);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, newCursorPos)));
  }

  return true;
};

export const todoKeymap = keymap({
  "Mod-Shift-C": toggleTodoAtLine,
  "Ctrl-Enter": toggleTodoAtLine,
  "Cmd-Enter": toggleTodoAtLine,
  "Enter": handleTodoEnter,
  "Backspace": handleTodoBackspace,
  "Tab": handleTodoIndent,
  "Shift-Tab": handleTodoOutdent,
});
