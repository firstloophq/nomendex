import * as React from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCommandDialog } from "@/components/CommandDialogProvider";

interface DeleteChatSessionDialogProps {
    sessionId: string;
    onSuccess?: () => void;
}

export function DeleteChatSessionDialog({ sessionId, onSuccess }: DeleteChatSessionDialogProps) {
    const [isDeleting, setIsDeleting] = React.useState(false);
    const { closeDialog } = useCommandDialog();

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const response = await fetch("/api/chat/sessions/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: sessionId }),
            });

            if (!response.ok) {
                throw new Error("Failed to delete session");
            }

            closeDialog();
            onSuccess?.();
        } catch (error) {
            console.error("Failed to delete chat session:", error);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>Delete this chat session?</DialogTitle>
                <DialogDescription>
                    This action cannot be undone. The session will be removed from your history.
                </DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button variant="ghost" onClick={closeDialog}>
                    Cancel
                </Button>
                <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={isDeleting}
                >
                    {isDeleting ? "Deleting..." : "Delete"}
                </Button>
            </DialogFooter>
        </>
    );
}
