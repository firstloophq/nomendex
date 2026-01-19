import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { notesAPI } from "@/hooks/useNotesAPI";
import { notesPluginSerial } from "@/features/notes";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { getDailyNoteFileName, parseDateFromInput } from "./date-utils";

interface DailyNoteDatePickerDialogProps {
    onSuccess?: (fileName: string) => void;
}

export function DailyNoteDatePickerDialog({ onSuccess }: DailyNoteDatePickerDialogProps) {
    const [selectedDate, setSelectedDate] = React.useState<Date>(new Date());
    const [dateInput, setDateInput] = React.useState("");
    const [isOpening, setIsOpening] = React.useState(false);
    const { closeDialog } = useCommandDialog();
    const { addNewTab, setActiveTabId } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();

    const handleDateInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setDateInput(value);

        const parsed = parseDateFromInput(value);
        if (parsed) {
            setSelectedDate(parsed);
        }
    }, []);

    const handleCalendarSelect = React.useCallback((date: Date | undefined) => {
        if (date) {
            setSelectedDate(date);
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const year = date.getFullYear();
            setDateInput(`${month}/${day}/${year}`);
        }
    }, []);

    const handleSubmit = React.useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!selectedDate) return;

        setIsOpening(true);
        try {
            const fileName = getDailyNoteFileName(selectedDate);

            // See if note exists
            const output = await notesAPI.getNoteByFileName({ fileName });
            if (!output) {
                await notesAPI.createNote({ fileName });
            }

            const newTab = addNewTab({
                pluginMeta: notesPluginSerial,
                view: "editor",
                props: { noteFileName: fileName },
            });

            if (newTab) {
                setActiveTabId(newTab.id);
            }

            // Navigate to workspace if not already there
            if (currentPath !== "/") {
                navigate("/");
            }

            closeDialog();
            onSuccess?.(fileName);
        } catch (error) {
            console.error("Failed to open daily note:", error);
        } finally {
            setIsOpening(false);
        }
    }, [selectedDate, addNewTab, setActiveTabId, closeDialog, onSuccess, currentPath, navigate]);

    // Add CMD+Enter keyboard shortcut support for Mac app
    useNativeSubmit(() => {
        if (selectedDate && !isOpening) {
            handleSubmit();
        }
    });

    const formattedDate = React.useMemo(() => {
        return selectedDate.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }, [selectedDate]);

    return (
        <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
                <div className="rounded-lg border bg-muted/50 p-4 text-center">
                    <p className="text-2xl font-semibold">{formattedDate}</p>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="date-input">Search</Label>
                    <Input
                        id="date-input"
                        value={dateInput}
                        onChange={handleDateInputChange}
                        placeholder="1/8, next wed, tomorrow, last fri..."
                        autoFocus
                    />
                </div>
                <div className="flex justify-center">
                    <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleCalendarSelect}
                        defaultMonth={selectedDate}
                    />
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                    Cancel
                </Button>
                <Button type="submit" disabled={!selectedDate || isOpening}>
                    {isOpening ? "Opening..." : "Open Note"}
                    <KeyboardIndicator keys={["cmd", "enter"]} />
                </Button>
            </DialogFooter>
        </form>
    );
}
