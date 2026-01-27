import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface DialogState {
    open: boolean;
    title?: string;
    description?: string;
    content?: React.ReactNode;
    width?: string;
    size?: "default" | "sm" | "md" | "lg" | "xl" | "2xl" | "full" | "jumbo";
}

interface CommandDialogContextType {
    openDialog: (config: Omit<DialogState, "open">) => void;
    closeDialog: () => void;
}

const CommandDialogContext = React.createContext<CommandDialogContextType | null>(null);

export function useCommandDialog() {
    const context = React.useContext(CommandDialogContext);
    if (!context) {
        throw new Error("useCommandDialog must be used within CommandDialogProvider");
    }
    return context;
}

export function CommandDialogProvider({ children }: { children: React.ReactNode }) {
    const [dialogState, setDialogState] = React.useState<DialogState>({ open: false });

    const openDialog = React.useCallback((config: Omit<DialogState, "open">) => {
        setDialogState({ ...config, open: true });
    }, []);

    const closeDialog = React.useCallback(() => {
        // Clear all dialog state when closing
        setDialogState({ open: false, title: undefined, description: undefined, content: undefined, width: undefined, size: undefined });
    }, []);

    const isJumbo = dialogState.size === "jumbo";

    return (
        <CommandDialogContext.Provider value={{ openDialog, closeDialog }}>
            {children}
            <Dialog open={dialogState.open} onOpenChange={(open) => !open && closeDialog()}>
                <DialogContent size={dialogState.size} style={dialogState.width ? { width: dialogState.width, maxWidth: '90vw' } : undefined}>
                    {dialogState.title && (
                        <DialogHeader className={isJumbo ? "shrink-0" : undefined}>
                            <DialogTitle>{dialogState.title}</DialogTitle>
                            {dialogState.description && <DialogDescription>{dialogState.description}</DialogDescription>}
                        </DialogHeader>
                    )}
                    {isJumbo ? (
                        <div className="flex-1 min-h-0 flex flex-col">
                            {dialogState.content}
                        </div>
                    ) : (
                        dialogState.content
                    )}
                </DialogContent>
            </Dialog>
        </CommandDialogContext.Provider>
    );
}