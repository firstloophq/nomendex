import { useState, useEffect, type ReactNode } from "react";
import { QuickCaptureDialog } from "@/features/captures/quick-capture-dialog";

interface QuickCaptureProviderProps {
    children: ReactNode;
}

/**
 * Provider component that listens for the nativeQuickCapture event
 * and opens the QuickCaptureDialog when triggered.
 *
 * Should be placed near the root of the app, inside WorkspaceProvider
 * so that it has access to workspace context.
 */
export function QuickCaptureProvider({ children }: QuickCaptureProviderProps) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const handleQuickCapture = () => {
            console.log("QuickCaptureProvider: nativeQuickCapture event received");
            setOpen(true);
        };

        document.addEventListener("nativeQuickCapture", handleQuickCapture);
        return () => {
            document.removeEventListener("nativeQuickCapture", handleQuickCapture);
        };
    }, []);

    return (
        <>
            {children}
            <QuickCaptureDialog open={open} onOpenChange={setOpen} />
        </>
    );
}
