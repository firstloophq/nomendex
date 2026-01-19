import * as React from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCommandDialog } from "@/components/CommandDialogProvider";

interface DeleteFolderDialogProps {
    folderName: string;
    onDelete: () => Promise<void>;
}

export function DeleteFolderDialog({ folderName, onDelete }: DeleteFolderDialogProps) {
    const [isDeleting, setIsDeleting] = React.useState(false);
    const { closeDialog } = useCommandDialog();

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await onDelete();
            closeDialog();
        } catch (error) {
            console.error("Failed to delete folder:", error);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>Delete Folder?</DialogTitle>
                <DialogDescription>
                    Are you sure you want to delete "{folderName}" and all its contents? This action cannot be undone.
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
