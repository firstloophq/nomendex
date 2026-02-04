import type { Command } from "@/types/Commands";

interface CommandContext {
    closeCommandMenu: () => void;
}

export function getCapturesCommands(context: CommandContext): Command[] {
    return [
        {
            id: "captures.quick",
            name: "Quick Capture",
            description: "Capture a quick note (Hyper+N)",
            icon: "Zap",
            callback: () => {
                context.closeCommandMenu();
                // Dispatch the same event that Swift sends
                document.dispatchEvent(new CustomEvent("nativeQuickCapture"));
            },
        },
    ];
}
