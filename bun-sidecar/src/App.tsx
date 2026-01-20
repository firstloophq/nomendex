import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RoutingProvider } from "./hooks/useRouting";
import { ThemeProvider } from "./hooks/useTheme";
import { useNativeKeyboardBridge } from "./hooks/useNativeKeyboardBridge";
import { useUpdateNotification } from "./hooks/useUpdateNotification";
import { useSkillUpdates } from "./hooks/useSkillUpdates";
import { WorkspacePage } from "./pages/WorkspacePage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { SyncPage } from "./pages/SyncPage";
import { ConflictResolvePage } from "./pages/ConflictResolvePage";
import { AgentsPage } from "./pages/AgentsPage";
import { McpServersPage } from "./pages/McpServersPage";
import { McpServerFormPage } from "./pages/McpServerFormPage";
import { NewAgentPage } from "./pages/NewAgentPage";
import { TestEditorPage } from "./features/test-editor";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { KeyboardShortcutsProvider } from "./contexts/KeyboardShortcutsContext";
import { GHSyncProvider } from "./contexts/GHSyncContext";
import { GHSyncSetupPrompt } from "./components/GHSyncSetupPrompt";
import { CommandDialogProvider } from "./components/CommandDialogProvider";
import { CommandMenu } from "./components/CommandMenu";
import { NotesCommandMenu } from "./components/NotesCommandMenu";
import { TabSwitcherMenu } from "./components/TabSwitcherMenu";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";
import { WorkspaceOnboarding } from "./components/WorkspaceOnboarding";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Bridge component for native Mac app keyboard handling
function NativeKeyboardBridge() {
    useNativeKeyboardBridge();
    return null;
}

// Dev component that throws during render to test ErrorBoundary
// Listens for 'dev:trigger-error' custom event
function DevErrorTrigger() {
    const [shouldThrow, setShouldThrow] = React.useState(false);

    React.useEffect(() => {
        const triggerHandler = () => setShouldThrow(true);
        const resetHandler = () => setShouldThrow(false);
        window.addEventListener("dev:trigger-error", triggerHandler);
        window.addEventListener("error-boundary:reset", resetHandler);
        return () => {
            window.removeEventListener("dev:trigger-error", triggerHandler);
            window.removeEventListener("error-boundary:reset", resetHandler);
        };
    }, []);

    if (shouldThrow) {
        throw new Error("Test error triggered from dev command");
    }

    return null;
}

// Bridge component for native Mac app update notifications
function UpdateNotificationBridge() {
    useUpdateNotification();
    return null;
}

// Bridge component for checking skill updates after workspace loads
function SkillUpdatesBridge() {
    useSkillUpdates();
    return null;
}

// Wrapper component that shows onboarding if no workspace is configured
function WorkspaceGuard({ children }: { children: React.ReactNode }) {
    const { activeWorkspace, loading } = useWorkspaceSwitcher();

    if (loading) {
        // Show a minimal loading state
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    if (!activeWorkspace) {
        return <WorkspaceOnboarding />;
    }

    return <>{children}</>;
}

export function App() {
    return (
        <ThemeProvider>
            <ErrorBoundary>
                <DevErrorTrigger />
                <NativeKeyboardBridge />
                <UpdateNotificationBridge />
                <BrowserRouter>
                    <RoutingProvider>
                        <WorkspaceGuard>
                            <WorkspaceProvider>
                                <SkillUpdatesBridge />
                                <KeyboardShortcutsProvider>
                                    <GHSyncProvider>
                                        <CommandDialogProvider>
                                            <Routes>
                                                {/* Main workspace - handles tabs for todos, notes */}
                                                <Route path="/" element={<WorkspacePage />} />

                                                {/* Settings and utility pages */}
                                                <Route path="/settings" element={<SettingsPage />} />
                                                <Route path="/help" element={<HelpPage />} />
                                                <Route path="/agents" element={<AgentsPage />} />
                                                <Route path="/new-agent" element={<NewAgentPage />} />
                                                <Route path="/mcp-servers" element={<McpServersPage />} />
                                                <Route path="/mcp-servers/new" element={<McpServerFormPage />} />
                                                <Route path="/mcp-servers/:serverId/edit" element={<McpServerFormPage />} />
                                                <Route path="/sync" element={<SyncPage />} />
                                                <Route path="/sync/resolve" element={<ConflictResolvePage />} />
                                                <Route path="/test-editor" element={<TestEditorPage />} />

                                                {/* Catch-all redirect to root */}
                                                <Route path="*" element={<Navigate to="/" replace />} />
                                            </Routes>
                                            <CommandMenu />
                                            <NotesCommandMenu />
                                            <TabSwitcherMenu />
                                            <GHSyncSetupPrompt />
                                        </CommandDialogProvider>
                                    </GHSyncProvider>
                                </KeyboardShortcutsProvider>
                            </WorkspaceProvider>
                        </WorkspaceGuard>
                    </RoutingProvider>
                </BrowserRouter>
                <Toaster position="top-right" richColors />
            </ErrorBoundary>
        </ThemeProvider>
    );
}

export default App;
