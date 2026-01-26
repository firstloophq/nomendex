"use client";

import { cn } from "@/lib/utils";
import { forwardRef, type ComponentProps } from "react";

export type ConversationProps = ComponentProps<"div">;

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative flex-1 overflow-y-auto", className)}
      role="log"
      {...props}
    />
  )
);
Conversation.displayName = "Conversation";

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <div
    className={cn("mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-2 p-6 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-0.5">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-xs">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

