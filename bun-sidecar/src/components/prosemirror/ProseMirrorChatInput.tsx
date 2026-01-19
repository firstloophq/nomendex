import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as markdownSchema, defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, chainCommands, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import "prosemirror-view/style/prosemirror.css";
import { resourceDecorationsPlugin } from "./resourceDecorations";
import { cn } from "@/lib/utils";
import { FilePickerDialog } from "./FilePickerDialog";
import { SkillPickerDialog } from "./SkillPickerDialog";
import { Skill } from "@/features/skills";

type ProseMirrorChatInputProps = {
    placeholder?: string;
    onSubmit?: (params: { text: string }) => void | Promise<void>;
    onChange?: (content: string) => void;
    className?: string;
    disabled?: boolean;
    enterToSend?: boolean;
};

export type ProseMirrorChatInputHandle = {
    clear: () => void;
    getContent: () => string;
    focus: () => void;
    setContent: (content: string) => void;
};

export const ProseMirrorChatInput = forwardRef<ProseMirrorChatInputHandle, ProseMirrorChatInputProps>(
    ({ placeholder = "Message...", onSubmit, onChange, className, disabled = false, enterToSend = true }, ref) => {
        const editorRef = useRef<HTMLDivElement | null>(null);
        const viewRef = useRef<EditorView | null>(null);
        const [isEmpty, setIsEmpty] = useState(true);
        const [isFocused, setIsFocused] = useState(false);
        const [filePickerOpen, setFilePickerOpen] = useState(false);
        const filePickerOpenRef = useRef(false);
        const atPositionRef = useRef<number | null>(null);
        const [skillPickerOpen, setSkillPickerOpen] = useState(false);
        const skillPickerOpenRef = useRef(false);
        const slashPositionRef = useRef<number | null>(null);

        // Stable refs for callbacks
        const onSubmitRef = useRef(onSubmit);
        const onChangeRef = useRef(onChange);
        useEffect(() => {
            onSubmitRef.current = onSubmit;
            onChangeRef.current = onChange;
        }, [onSubmit, onChange]);

        // Keep refs in sync with state
        useEffect(() => {
            filePickerOpenRef.current = filePickerOpen;
        }, [filePickerOpen]);

        useEffect(() => {
            skillPickerOpenRef.current = skillPickerOpen;
        }, [skillPickerOpen]);

        // Handle file selection from dialog
        const handleFileSelect = useCallback((item: { id: string; label: string; type: string }) => {
            const view = viewRef.current;
            if (!view) return;

            const atPos = atPositionRef.current;
            if (atPos === null) return;

            // Insert the file reference with trailing space, replacing the @ character
            const text = `${item.id} `;
            const tr = view.state.tr.insertText(text, atPos, atPos + 1);
            const newPos = atPos + text.length;
            tr.setSelection(TextSelection.create(tr.doc, newPos));
            view.dispatch(tr.scrollIntoView());

            // Clear the position ref
            atPositionRef.current = null;

            // Focus editor after dialog closes (small delay to ensure dialog is fully closed)
            setTimeout(() => {
                view.focus();
            }, 50);
        }, []);

        // Handle skill selection from dialog
        const handleSkillSelect = useCallback((skill: Skill) => {
            const view = viewRef.current;
            if (!view) return;

            const slashPos = slashPositionRef.current;
            if (slashPos === null) return;

            // Insert "use the [name] Skill" with trailing space, replacing the / character
            const text = `use the ${skill.name} Skill `;
            const tr = view.state.tr.insertText(text, slashPos, slashPos + 1);
            const newPos = slashPos + text.length;
            tr.setSelection(TextSelection.create(tr.doc, newPos));
            view.dispatch(tr.scrollIntoView());

            // Clear the position ref
            slashPositionRef.current = null;

            // Focus editor after dialog closes (small delay to ensure dialog is fully closed)
            setTimeout(() => {
                view.focus();
            }, 50);
        }, []);

        // Expose imperative methods
        useImperativeHandle(ref, () => ({
            clear: () => {
                const view = viewRef.current;
                if (!view) return;
                const emptyDoc = markdownSchema.topNodeType.createAndFill();
                if (emptyDoc) {
                    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, emptyDoc.content);
                    view.dispatch(tr);
                    setIsEmpty(true);
                    if (onChangeRef.current) onChangeRef.current("");
                }
            },
            getContent: () => {
                const view = viewRef.current;
                if (!view) return "";
                return defaultMarkdownSerializer.serialize(view.state.doc);
            },
            focus: () => {
                viewRef.current?.focus();
            },
            setContent: (content: string) => {
                const view = viewRef.current;
                if (!view) return;
                // Parse the content as markdown
                const newDoc = defaultMarkdownParser.parse(content);
                if (newDoc) {
                    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
                    // Move cursor to end
                    const endPos = tr.doc.content.size;
                    tr.setSelection(TextSelection.create(tr.doc, endPos));
                    view.dispatch(tr);
                    setIsEmpty(content.length === 0);
                    if (onChangeRef.current) onChangeRef.current(content);
                }
            },
        }));

        // Listen for native submit event from Mac app (Swift dispatches custom event)
        // Each input listens but only the focused one responds
        // Note: Browser keyboard events are handled by ProseMirror's handleKeyDown below
        useEffect(() => {
            const handleNativeSubmit = () => {
                // Don't submit if dialogs are open
                if (filePickerOpenRef.current || skillPickerOpenRef.current) return;

                const view = viewRef.current;
                if (!view) return;

                // Only respond if this editor has focus
                const editorElement = view.dom;
                if (editorElement.contains(document.activeElement) || document.activeElement === editorElement) {
                    const content = defaultMarkdownSerializer.serialize(view.state.doc);
                    if (content.trim() && onSubmitRef.current) {
                        onSubmitRef.current({ text: content.trim() });
                    }
                }
            };

            // Listen for custom event from native Mac app
            window.addEventListener("nativeSubmit", handleNativeSubmit);

            return () => {
                window.removeEventListener("nativeSubmit", handleNativeSubmit);
            };
        }, []);

        // Initialize editor
        useEffect(() => {
            if (!editorRef.current) return;

            const startDoc = defaultMarkdownParser.parse("");
            const state = EditorState.create({
                doc: startDoc,
                schema: markdownSchema,
                plugins: [
                    resourceDecorationsPlugin(),
                    history(),
                    keymap({
                        "Mod-z": undo,
                        "Mod-Shift-z": redo,
                        "Mod-y": redo,
                    }),
                    keymap(baseKeymap),
                ],
            });

            const view = new EditorView(editorRef.current, {
                state,
                editable: () => !disabled,
                attributes: {
                    class: "pm-chat-input-content",
                },
                handleDOMEvents: {
                    focus: () => {
                        setIsFocused(true);
                        return false;
                    },
                    blur: () => {
                        setIsFocused(false);
                        return false;
                    },
                },
                handleTextInput(view, from, _to, text) {
                    // Detect @ being typed for file picker
                    if (text === "@") {
                        // Store the position where @ will be inserted
                        atPositionRef.current = from;
                        // Let the @ be inserted first, then open dialog
                        setTimeout(() => {
                            setFilePickerOpen(true);
                        }, 0);
                    }
                    // Detect / being typed for skill picker
                    if (text === "/") {
                        // Store the position where / will be inserted
                        slashPositionRef.current = from;
                        // Let the / be inserted first, then open dialog
                        setTimeout(() => {
                            setSkillPickerOpen(true);
                        }, 0);
                    }
                    return false; // Let default handling proceed
                },
                // Handle Enter to submit, Shift+Enter to insert newline (based on enterToSend setting)
                handleKeyDown(view, event) {
                    if (event.key === "Enter") {
                        // Don't handle Enter if file picker or skill picker is open
                        if (filePickerOpenRef.current || skillPickerOpenRef.current) return false;

                        // Helper to insert a newline (split block)
                        const insertNewline = () => {
                            const cmd = chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock);
                            return cmd(view.state, view.dispatch);
                        };

                        if (enterToSend) {
                            // New behavior: Enter sends, Shift+Enter inserts newline
                            if (event.shiftKey) {
                                event.preventDefault();
                                insertNewline();
                                return true;
                            }

                            // Plain Enter submits the message
                            event.preventDefault();
                            const content = defaultMarkdownSerializer.serialize(view.state.doc);
                            if (content.trim() && onSubmitRef.current) {
                                onSubmitRef.current({ text: content.trim() });
                            }
                            return true; // Handled
                        } else {
                            // Old behavior: Cmd/Ctrl+Enter sends, Enter inserts newline
                            if (event.metaKey || event.ctrlKey) {
                                event.preventDefault();
                                const content = defaultMarkdownSerializer.serialize(view.state.doc);
                                if (content.trim() && onSubmitRef.current) {
                                    onSubmitRef.current({ text: content.trim() });
                                }
                                return true; // Handled
                            }
                            // Plain Enter inserts newline
                            event.preventDefault();
                            insertNewline();
                            return true;
                        }
                    }
                    return false; // Let other handlers process
                },
                dispatchTransaction(transaction) {
                    const newState = view.state.apply(transaction);
                    view.updateState(newState);

                    const markdown = defaultMarkdownSerializer.serialize(newState.doc);
                    const docIsEmpty = !markdown.trim();
                    setIsEmpty(docIsEmpty);

                    if (onChangeRef.current) {
                        onChangeRef.current(markdown);
                    }
                },
            });
            viewRef.current = view;

            return () => {
                view.destroy();
                viewRef.current = null;
            };
        }, [disabled, enterToSend]);

        // Handle file picker dialog close without selection - keep the @ and restore cursor
        const handleDialogOpenChange = useCallback((open: boolean) => {
            setFilePickerOpen(open);
            if (!open) {
                const view = viewRef.current;
                if (view) {
                    // Restore focus and cursor position after the @ character
                    setTimeout(() => {
                        view.focus();
                        if (atPositionRef.current !== null) {
                            // Place cursor right after the @ character
                            const cursorPos = Math.min(atPositionRef.current + 1, view.state.doc.content.size);
                            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, cursorPos));
                            view.dispatch(tr);
                        }
                        atPositionRef.current = null;
                    }, 50);
                } else {
                    atPositionRef.current = null;
                }
            }
        }, []);

        // Handle skill picker dialog close without selection - keep the / and restore cursor
        const handleSkillDialogOpenChange = useCallback((open: boolean) => {
            setSkillPickerOpen(open);
            if (!open) {
                const view = viewRef.current;
                if (view) {
                    // Restore focus and cursor position after the / character
                    setTimeout(() => {
                        view.focus();
                        if (slashPositionRef.current !== null) {
                            // Place cursor right after the / character
                            const cursorPos = Math.min(slashPositionRef.current + 1, view.state.doc.content.size);
                            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, cursorPos));
                            view.dispatch(tr);
                        }
                        slashPositionRef.current = null;
                    }, 50);
                } else {
                    slashPositionRef.current = null;
                }
            }
        }, []);

        return (
            <>
                <div className={cn("pm-chat-input-wrapper relative", className)}>
                    <div
                        ref={editorRef}
                        className={cn(
                            "pm-chat-input min-h-[44px] w-full px-4 py-3 text-sm",
                            "[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[20px]",
                            "[&_.ProseMirror_p]:m-0",
                            "[&_.pm-resource-uri]:text-primary [&_.pm-resource-uri]:font-medium",
                            "[&_.ProseMirror]:caret-foreground",
                            disabled && "opacity-50 pointer-events-none"
                        )}
                    />
                    {isEmpty && !isFocused && placeholder && (
                        <div
                            className="absolute top-3 left-4 text-sm text-muted-foreground pointer-events-none"
                            aria-hidden="true"
                        >
                            {placeholder}
                        </div>
                    )}
                </div>

                <FilePickerDialog
                    open={filePickerOpen}
                    onOpenChange={handleDialogOpenChange}
                    onSelect={handleFileSelect}
                />

                <SkillPickerDialog
                    open={skillPickerOpen}
                    onOpenChange={handleSkillDialogOpenChange}
                    onSelect={handleSkillSelect}
                />
            </>
        );
    }
);

ProseMirrorChatInput.displayName = "ProseMirrorChatInput";
