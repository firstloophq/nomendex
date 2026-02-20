import { useState } from "react";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTheme } from "@/hooks/useTheme";
import { Users, User, Loader2 } from "lucide-react";

/**
 * Full-screen mode selector shown on first launch when appMode hasn't been set yet.
 */
export function AppModeSelector() {
    const { setAppMode } = useWorkspaceSwitcher();
    const { currentTheme } = useTheme();
    const [selecting, setSelecting] = useState<"solo" | "team" | null>(null);

    const handleSelect = async (mode: "solo" | "team") => {
        setSelecting(mode);
        try {
            await setAppMode(mode);
        } finally {
            setSelecting(null);
        }
    };

    return (
        <div
            className="flex flex-col items-center justify-center h-screen gap-8 px-6"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                    Welcome to Nomendex
                </h1>
                <p style={{ color: currentTheme.styles.contentSecondary }}>
                    How would you like to use the app?
                </p>
            </div>

            <div className="flex gap-4">
                <button
                    onClick={() => handleSelect("solo")}
                    disabled={selecting !== null}
                    className="flex flex-col items-center gap-3 p-6 rounded-lg border cursor-pointer transition-colors w-48"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    {selecting === "solo" ? (
                        <Loader2 className="h-8 w-8 animate-spin" style={{ color: currentTheme.styles.contentSecondary }} />
                    ) : (
                        <User className="h-8 w-8" style={{ color: currentTheme.styles.contentPrimary }} />
                    )}
                    <span className="font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                        Solo
                    </span>
                    <span className="text-xs text-center" style={{ color: currentTheme.styles.contentSecondary }}>
                        All data stays local on your machine
                    </span>
                </button>

                <button
                    onClick={() => handleSelect("team")}
                    disabled={selecting !== null}
                    className="flex flex-col items-center gap-3 p-6 rounded-lg border cursor-pointer transition-colors w-48"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    {selecting === "team" ? (
                        <Loader2 className="h-8 w-8 animate-spin" style={{ color: currentTheme.styles.contentSecondary }} />
                    ) : (
                        <Users className="h-8 w-8" style={{ color: currentTheme.styles.contentPrimary }} />
                    )}
                    <span className="font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                        Team
                    </span>
                    <span className="text-xs text-center" style={{ color: currentTheme.styles.contentSecondary }}>
                        Real-time collaboration with sign-in
                    </span>
                </button>
            </div>

            <p className="text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                You can change this later in settings.
            </p>
        </div>
    );
}
