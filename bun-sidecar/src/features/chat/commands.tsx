import { Command } from "@/types/Commands";
import { chatPluginSerial } from "./index";
import { WorkspaceTab } from "@/types/Workspace";
import { SerializablePlugin } from "@/types/Plugin";

interface CommandContext {
    closeCommandMenu: () => void;
    addNewTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    openTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    setActiveTabId: (id: string) => void;
    navigate: (path: string) => void;
    currentPath: string;
}

export function getChatCommands(context: CommandContext): Command[] {
    return [
        {
            id: "chat.open",
            name: "Chats",
            description: "Open the chat browser",
            icon: "MessageCircle",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: chatPluginSerial,
                    view: "browser",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "chat.new",
            name: "New Chat",
            description: "Start a new chat conversation",
            icon: "Plus",
            callback: () => {
                context.closeCommandMenu();
                const newTab = context.addNewTab({
                    pluginMeta: chatPluginSerial,
                    view: "chat",
                    props: {},
                });

                if (newTab) {
                    context.setActiveTabId(newTab.id);
                }
                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
    ];
}
