"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, Paperclip, X } from "lucide-react";
import {
    type ComponentProps,
    type FormEvent,
    type KeyboardEvent,
    type ReactNode,
    type DragEvent,
    type ClipboardEvent,
    createContext,
    useContext,
    useCallback,
    forwardRef,
    useRef,
    useImperativeHandle,
    useState,
} from "react";
import { ProseMirrorChatInput, type ProseMirrorChatInputHandle } from "./ProseMirrorChatInput";
import type { Attachment } from "@/types/attachments";
import { useTheme } from "@/hooks/useTheme";

type ProseMirrorPromptContextType = {
    isLoading: boolean;
    hasContent: boolean;
    inputRef: React.RefObject<ProseMirrorChatInputHandle | null>;
    formRef: React.RefObject<HTMLFormElement | null>;
    setHasContent: (val: boolean) => void;
    attachments: Attachment[];
    addAttachment: (attachment: Attachment) => void;
    removeAttachment: (id: string) => void;
    clearAttachments: () => void;
    uploadFile: (file: File) => Promise<Attachment | null>;
};

const ProseMirrorPromptContext = createContext<ProseMirrorPromptContextType | null>(null);

export function useProseMirrorPrompt() {
    const context = useContext(ProseMirrorPromptContext);
    if (!context) {
        throw new Error("useProseMirrorPrompt must be used within a ProseMirrorPromptInput");
    }
    return context;
}

export type ProseMirrorPromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
    onSubmit: (params: { text: string; attachments: Attachment[] }) => void | Promise<void>;
    isLoading?: boolean;
    children?: ReactNode;
};

async function uploadFileToServer(file: File): Promise<Attachment | null> {
    try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/uploads", {
            method: "POST",
            body: formData,
        });

        const result = await response.json();
        if (result.success && result.data) {
            return result.data as Attachment;
        }
        console.error("Upload failed:", result.error);
        return null;
    } catch (error) {
        console.error("Upload error:", error);
        return null;
    }
}

export const ProseMirrorPromptInput = ({
    className,
    onSubmit,
    isLoading = false,
    children,
    ...props
}: ProseMirrorPromptInputProps) => {
    const inputRef = useRef<ProseMirrorChatInputHandle | null>(null);
    const [hasContent, setHasContent] = useState(false);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const { currentTheme } = useTheme();

    const formRef = useRef<HTMLFormElement>(null);

    const addAttachment = useCallback((attachment: Attachment) => {
        setAttachments(prev => [...prev, attachment]);
    }, []);

    const removeAttachment = useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachments([]);
    }, []);

    const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
        const attachment = await uploadFileToServer(file);
        if (attachment) {
            addAttachment(attachment);
        }
        return attachment;
    }, [addAttachment]);

    const handleSubmit = useCallback(
        async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const text = inputRef.current?.getContent() ?? "";
            if ((!text.trim() && attachments.length === 0) || isLoading) return;

            // Capture attachments before clearing
            const currentAttachments = [...attachments];

            // Clear immediately so user can type while response streams
            inputRef.current?.clear();
            setHasContent(false);
            clearAttachments();

            await onSubmit({ text: text.trim(), attachments: currentAttachments });
        },
        [isLoading, onSubmit, attachments, clearAttachments]
    );

    // Handle drag events
    const handleDragOver = useCallback((e: DragEvent<HTMLFormElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: DragEvent<HTMLFormElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(async (e: DragEvent<HTMLFormElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(f => f.type.startsWith("image/"));

        for (const file of imageFiles) {
            await uploadFile(file);
        }
    }, [uploadFile]);

    // Handle paste events
    const handlePaste = useCallback(async (e: ClipboardEvent<HTMLFormElement>) => {
        const items = Array.from(e.clipboardData.items);
        const imageItems = items.filter(item => item.type.startsWith("image/"));

        if (imageItems.length > 0) {
            e.preventDefault(); // Prevent default paste if we have images
            for (const item of imageItems) {
                const file = item.getAsFile();
                if (file) {
                    await uploadFile(file);
                }
            }
        }
    }, [uploadFile]);

    // Trap Tab within the form to cycle through: input -> agent selector -> submit button
    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLFormElement>) => {
        if (e.key !== "Tab") return;

        const form = formRef.current;
        if (!form) return;

        // Get all focusable elements within the form
        const focusableElements = form.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled]), .ProseMirror'
        );
        const focusableArray = Array.from(focusableElements);

        if (focusableArray.length === 0) return;

        const currentIndex = focusableArray.findIndex(
            (el) => el === document.activeElement || el.contains(document.activeElement)
        );

        e.preventDefault();

        if (e.shiftKey) {
            // Move to previous, wrap to end
            const prevIndex = currentIndex <= 0 ? focusableArray.length - 1 : currentIndex - 1;
            focusableArray[prevIndex]?.focus();
        } else {
            // Move to next, wrap to start
            const nextIndex = currentIndex >= focusableArray.length - 1 ? 0 : currentIndex + 1;
            focusableArray[nextIndex]?.focus();
        }
    }, []);

    return (
        <ProseMirrorPromptContext.Provider
            value={{
                isLoading,
                hasContent,
                inputRef,
                formRef,
                setHasContent,
                attachments,
                addAttachment,
                removeAttachment,
                clearAttachments,
                uploadFile,
            }}
        >
            <form
                ref={formRef}
                className={cn(
                    "relative rounded-2xl border bg-background shadow-sm",
                    isDragging && "ring-2 ring-primary",
                    className
                )}
                onSubmit={handleSubmit}
                onKeyDown={handleKeyDown}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onPaste={handlePaste}
                {...props}
            >
                {/* Attachment thumbnails */}
                {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3 pt-3">
                        {attachments.map((attachment) => (
                            <div
                                key={attachment.id}
                                className="relative group size-16 rounded-lg overflow-hidden"
                                style={{
                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                    border: `1px solid ${currentTheme.styles.borderDefault}`,
                                }}
                            >
                                <img
                                    src={attachment.url}
                                    alt={attachment.originalName}
                                    className="w-full h-full object-cover"
                                />
                                <button
                                    type="button"
                                    onClick={() => removeAttachment(attachment.id)}
                                    className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-full"
                                    style={{
                                        backgroundColor: currentTheme.styles.semanticDestructive,
                                        color: "white",
                                    }}
                                    title="Remove"
                                >
                                    <X className="size-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Drag overlay */}
                {isDragging && (
                    <div
                        className="absolute inset-0 flex items-center justify-center rounded-2xl z-10"
                        style={{
                            backgroundColor: `${currentTheme.styles.surfacePrimary}ee`,
                            border: `2px dashed ${currentTheme.styles.contentSecondary}`,
                        }}
                    >
                        <span style={{ color: currentTheme.styles.contentSecondary }}>
                            Drop images here
                        </span>
                    </div>
                )}

                {children}
            </form>
        </ProseMirrorPromptContext.Provider>
    );
};

export type ProseMirrorPromptTextareaProps = {
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    enterToSend?: boolean;
};

export type ProseMirrorPromptTextareaHandle = ProseMirrorChatInputHandle;

export const ProseMirrorPromptTextarea = forwardRef<ProseMirrorPromptTextareaHandle, ProseMirrorPromptTextareaProps>(
    ({ className, placeholder = "Message...", disabled, enterToSend = true }, ref) => {
        const context = useContext(ProseMirrorPromptContext);
        const localRef = useRef<ProseMirrorChatInputHandle | null>(null);

        // Use context ref if available, otherwise use local ref
        const actualRef = context?.inputRef ?? localRef;

        useImperativeHandle(ref, () => ({
            clear: () => actualRef.current?.clear(),
            getContent: () => actualRef.current?.getContent() ?? "",
            focus: () => actualRef.current?.focus(),
            setContent: (content: string) => actualRef.current?.setContent(content),
        }));

        // Allow typing while agent is responding (isLoading), only respect explicit disabled prop
        const isDisabled = disabled ?? false;

        const handleSubmit = useCallback(async (_params: { text: string }) => {
            // Submit is handled by the parent form's onSubmit
            // This is triggered by Enter key in ProseMirror
            // Use context's formRef to ensure we submit the correct form when multiple chat tabs are open
            const form = context?.formRef.current;
            if (form) {
                const event = new Event("submit", { bubbles: true, cancelable: true });
                form.dispatchEvent(event);
            }
        }, [context?.formRef]);

        const handleChange = useCallback((content: string) => {
            context?.setHasContent(!!content.trim());
        }, [context]);

        return (
            <ProseMirrorChatInput
                ref={actualRef}
                placeholder={placeholder}
                disabled={isDisabled}
                onSubmit={handleSubmit}
                onChange={handleChange}
                className={cn("min-h-[44px] text-sm", className)}
                enterToSend={enterToSend}
            />
        );
    }
);

ProseMirrorPromptTextarea.displayName = "ProseMirrorPromptTextarea";

export type ProseMirrorPromptFooterProps = ComponentProps<"div">;

export const ProseMirrorPromptFooter = ({
    className,
    children,
    ...props
}: ProseMirrorPromptFooterProps) => (
    <div
        className={cn(
            "flex items-center justify-between px-3 pb-3",
            className
        )}
        {...props}
    >
        {children}
    </div>
);

export type ProseMirrorPromptSubmitProps = ComponentProps<typeof Button>;

export const ProseMirrorPromptSubmit = ({
    className,
    disabled,
    children,
    ...props
}: ProseMirrorPromptSubmitProps) => {
    const context = useContext(ProseMirrorPromptContext);
    const isLoading = context?.isLoading ?? false;
    const hasContent = context?.hasContent ?? false;
    const hasAttachments = (context?.attachments.length ?? 0) > 0;

    return (
        <Button
            className={cn("h-8 w-8 rounded-full p-0", className)}
            disabled={disabled || isLoading || (!hasContent && !hasAttachments)}
            size="icon"
            type="submit"
            {...props}
        >
            {children ?? <ArrowUpIcon className="h-4 w-4" />}
        </Button>
    );
};

export type ProseMirrorPromptAttachProps = ComponentProps<typeof Button>;

export const ProseMirrorPromptAttach = ({
    className,
    disabled,
    ...props
}: ProseMirrorPromptAttachProps) => {
    const context = useContext(ProseMirrorPromptContext);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            if (file.type.startsWith("image/")) {
                await context?.uploadFile(file);
            }
        }
        // Reset input so same file can be selected again
        e.target.value = "";
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
            />
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8 rounded-full p-0", className)}
                disabled={disabled}
                onClick={handleClick}
                title="Attach image"
                {...props}
            >
                <Paperclip className="h-4 w-4" />
            </Button>
        </>
    );
};
