import * as React from "react"
import { flushSync } from "react-dom"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/useTheme"
import { subscribe } from "@/lib/events"

function Dialog({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  // Close dialog when workspace closes all tabs
  React.useEffect(() => {
    if (!open) return;

    return subscribe("workspace:closeAllTabs", () => {
      // Use flushSync to force synchronous state update before component unmounts
      flushSync(() => {
        onOpenChange?.(false);
      });
    });
  }, [open, onOpenChange]);

  return <DialogPrimitive.Root data-slot="dialog" open={open} onOpenChange={onOpenChange} {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
          <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 backdrop-blur-sm pointer-events-auto",
          className
        )}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        {...props}
      />
  )
}

const dialogContentVariants = cva(
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-[60] w-full translate-x-[-50%] translate-y-[-50%] border duration-200",
  {
    variants: {
      size: {
        default: "grid gap-4 max-w-[calc(100%-2rem)] p-6 sm:max-w-lg",
        sm: "grid gap-4 max-w-[calc(100%-2rem)] p-4 sm:max-w-sm",
        md: "grid gap-4 max-w-[calc(100%-2rem)] p-6 sm:max-w-md",
        lg: "grid gap-4 max-w-[calc(100%-2rem)] p-6 sm:max-w-2xl",
        xl: "grid gap-4 max-w-[calc(100%-2rem)] p-6 sm:max-w-4xl",
        "2xl": "grid gap-4 max-w-[calc(100%-2rem)] p-6 sm:max-w-6xl",
        full: "grid gap-4 max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] p-6 sm:max-w-[calc(100%-4rem)] sm:max-h-[calc(100%-4rem)]",
        jumbo: "flex flex-col w-[90vw] h-[90vh] max-w-[90vw] max-h-[90vh] p-6",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants> & {
  showCloseButton?: boolean
}) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogContentVariants({ size }), className)}
        style={{
          backgroundColor: styles.surfaceSecondary,
          color: styles.contentPrimary,
          borderColor: styles.borderDefault,
          borderRadius: styles.borderRadius,
          boxShadow: styles.shadowLg,
          ...style,
        }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            tabIndex={-1}
            className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            style={{
              color: styles.contentSecondary,
            }}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      style={{
        color: styles.contentPrimary,
        ...style,
      }}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm", className)}
      style={{
        color: styles.contentSecondary,
        ...style,
      }}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
