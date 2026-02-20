import { Button } from "@/components/ui/button";
import { useTeamAuth } from "@/contexts/AuthContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTheme } from "@/hooks/useTheme";
import { LogIn } from "lucide-react";

/**
 * Full-screen sign-in gate shown when app is in team mode but user isn't authenticated.
 */
export function TeamSignInScreen() {
    const { signIn } = useTeamAuth();
    const { setAppMode } = useWorkspaceSwitcher();
    const { currentTheme } = useTheme();

    return (
        <div
            className="flex flex-col items-center justify-center h-screen gap-6"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                color: currentTheme.styles.contentPrimary,
            }}
        >
            <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>
                Nomendex
            </h1>
            <p style={{ color: currentTheme.styles.contentSecondary }}>
                Sign in to access your team workspace
            </p>
            <Button onClick={() => signIn()}>
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
            </Button>
            <button
                onClick={() => setAppMode("solo")}
                className="text-xs underline cursor-pointer"
                style={{ color: currentTheme.styles.contentTertiary }}
            >
                Switch to Solo mode
            </button>
        </div>
    );
}
