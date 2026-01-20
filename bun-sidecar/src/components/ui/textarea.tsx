import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

function Textarea({ className, autoComplete, autoCorrect, autoCapitalize, spellCheck, style, ...props }: React.ComponentProps<"textarea">) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <textarea
      data-slot="textarea"
      autoComplete={autoComplete ?? "off"}
      autoCorrect={autoCorrect ?? "off"}
      autoCapitalize={autoCapitalize ?? "off"}
      spellCheck={spellCheck ?? false}
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm placeholder:text-[var(--input-placeholder)]",
        className
      )}
      style={{
        "--input-placeholder": styles.contentTertiary,
        backgroundColor: "transparent",
        color: styles.contentPrimary,
        borderColor: styles.borderDefault,
        borderRadius: styles.borderRadius,
        boxShadow: styles.shadowSm,
        ...style,
      } as React.CSSProperties}
      {...props}
    />
  )
}

export { Textarea }
