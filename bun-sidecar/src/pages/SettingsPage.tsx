import { useState, useEffect } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Separator } from "../components/ui/separator";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useKeyboardShortcuts } from "@/contexts/KeyboardShortcutsContext";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { KeyboardIndicator } from "@/components/ui/keyboard-indicator";
import { useTheme } from "@/hooks/useTheme";
import { triggerNativeUpdate } from "@/hooks/useUpdateNotification";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

import { RotateCcw, Eye, EyeOff, Check, X, Key, RefreshCw, Info, Plus, Trash2, FolderOpen } from "lucide-react";
import { Input } from "../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import type { NotesLocation } from "@/types/Workspace";

type SecretInfo = {
    key: string;
    label: string;
    description: string;
    placeholder: string;
    helpText: string;
    hasValue: boolean;
    maskedValue: string;
    isPredefined: boolean;
};

function StorageSettings() {
    const { notesLocation, setNotesLocation } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const [pendingChange, setPendingChange] = useState<NotesLocation | null>(null);

    const handleNotesLocationChange = (value: string) => {
        const newLocation = value as NotesLocation;
        setPendingChange(newLocation);
    };

    const applyChange = async () => {
        if (pendingChange) {
            setNotesLocation(pendingChange);
            setPendingChange(null);
            // Wait a moment for the workspace state to save, then reinitialize paths on the server
            await new Promise(resolve => setTimeout(resolve, 100));
            await fetch("/api/workspace/reinitialize", { method: "POST" });
            // Reload the page to pick up the new paths
            window.location.reload();
        }
    };

    const cancelChange = () => {
        setPendingChange(null);
    };

    const displayValue = pendingChange ?? notesLocation;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5" />
                    Storage Settings
                </CardTitle>
                <CardDescription>
                    Configure where your files are stored in the workspace
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div
                    className="p-4 rounded-lg border"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <h4 className="font-medium mb-2" style={{ color: currentTheme.styles.contentPrimary }}>
                        Notes Location
                    </h4>
                    <p className="text-sm mb-4" style={{ color: currentTheme.styles.contentSecondary }}>
                        Choose where notes are stored in your workspace. Use "Workspace Root" for Obsidian compatibility.
                    </p>

                    <RadioGroup
                        value={displayValue}
                        onValueChange={handleNotesLocationChange}
                        className="space-y-3"
                    >
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="subfolder" id="subfolder" className="mt-1" />
                            <div className="flex-1">
                                <Label htmlFor="subfolder" className="font-medium cursor-pointer">
                                    Notes Subfolder
                                </Label>
                                <p className="text-sm" style={{ color: currentTheme.styles.contentTertiary }}>
                                    Store notes in <code className="px-1 py-0.5 rounded" style={{ backgroundColor: currentTheme.styles.surfaceTertiary }}>/notes</code> subfolder
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="root" id="root" className="mt-1" />
                            <div className="flex-1">
                                <Label htmlFor="root" className="font-medium cursor-pointer">
                                    Workspace Root
                                </Label>
                                <p className="text-sm" style={{ color: currentTheme.styles.contentTertiary }}>
                                    Store notes at workspace root (default, Obsidian-compatible)
                                </p>
                            </div>
                        </div>
                    </RadioGroup>

                    {pendingChange && (
                        <div className="mt-4 pt-4 border-t" style={{ borderColor: currentTheme.styles.borderDefault }}>
                            <p className="text-sm mb-3" style={{ color: currentTheme.styles.contentSecondary }}>
                                Changing notes location requires a page reload. Your existing notes will not be moved automatically.
                            </p>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={applyChange}>
                                    Apply & Reload
                                </Button>
                                <Button size="sm" variant="ghost" onClick={cancelChange}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function SettingsContent() {
    const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
    const [recordingKeys, setRecordingKeys] = useState<string[]>([]);
    const { setTheme, themes, currentTheme } = useTheme();
    const { shortcuts, updateShortcut, resetShortcut, resetAllShortcuts } = useKeyboardShortcuts();
    const { chatInputEnterToSend, setChatInputEnterToSend, workspace } = useWorkspaceContext();

    // Local state for pending preference change
    const [pendingEnterToSend, setPendingEnterToSend] = useState<boolean | null>(null);
    const [savingPreference, setSavingPreference] = useState(false);
    const [savedPreference, setSavedPreference] = useState(false);

    // Debug logging
    useEffect(() => {
        console.log("[Preferences] chatInputEnterToSend from context:", chatInputEnterToSend);
        console.log("[Preferences] Full workspace state:", workspace);
    }, [chatInputEnterToSend, workspace]);

    const handleSavePreference = async () => {
        if (pendingEnterToSend === null) return;

        console.log("[Preferences] Saving chatInputEnterToSend:", pendingEnterToSend);
        setSavingPreference(true);
        setSavedPreference(false);

        try {
            // Fetch current workspace state from server
            const fetchResponse = await fetch("/api/workspace");
            const fetchResult = await fetchResponse.json();
            console.log("[Preferences] Current workspace from server:", fetchResult);

            if (!fetchResult.success) {
                throw new Error("Failed to fetch current workspace");
            }

            // Merge with new preference
            const updatedWorkspace = {
                ...fetchResult.data,
                chatInputEnterToSend: pendingEnterToSend,
            };
            console.log("[Preferences] Saving updated workspace:", updatedWorkspace);

            // Save directly to API
            const saveResponse = await fetch("/api/workspace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedWorkspace),
            });
            const saveResult = await saveResponse.json();
            console.log("[Preferences] Save response:", saveResult);

            if (!saveResult.success) {
                throw new Error("Failed to save workspace");
            }

            // Update local state
            setChatInputEnterToSend(pendingEnterToSend);

            console.log("[Preferences] Save complete");
            setSavedPreference(true);
            setPendingEnterToSend(null);
            // Clear the saved indicator after 2 seconds
            setTimeout(() => setSavedPreference(false), 2000);
        } catch (error) {
            console.error("[Preferences] Save failed:", error);
        } finally {
            setSavingPreference(false);
        }
    };

    const currentValue = pendingEnterToSend !== null ? pendingEnterToSend : chatInputEnterToSend;
    const hasUnsavedChanges = pendingEnterToSend !== null && pendingEnterToSend !== chatInputEnterToSend;

    // Secrets state
    const [secrets, setSecrets] = useState<SecretInfo[]>([]);
    const [editingSecret, setEditingSecret] = useState<string | null>(null);
    const [secretValue, setSecretValue] = useState("");
    const [showSecretValue, setShowSecretValue] = useState(false);
    const [secretsLoading, setSecretsLoading] = useState(true);
    const [savingSecret, setSavingSecret] = useState(false);

    // New custom secret state
    const [isAddingCustom, setIsAddingCustom] = useState(false);
    const [newSecretKey, setNewSecretKey] = useState("");
    const [newSecretValue, setNewSecretValue] = useState("");
    const [showNewSecretValue, setShowNewSecretValue] = useState(false);
    const [newSecretError, setNewSecretError] = useState("");

    // Version state
    const [versionInfo, setVersionInfo] = useState<{ version: string; buildNumber: string } | null>(null);
    const [checkingForUpdates, setCheckingForUpdates] = useState(false);

    // Load secrets on mount
    useEffect(() => {
        async function loadSecrets() {
            try {
                const response = await fetch("/api/secrets/list");
                if (response.ok) {
                    const data = await response.json();
                    setSecrets(data.secrets);
                }
            } catch (error) {
                console.error("Failed to load secrets:", error);
            } finally {
                setSecretsLoading(false);
            }
        }
        loadSecrets();
    }, []);

    // Load version info on mount
    useEffect(() => {
        async function loadVersion() {
            try {
                const response = await fetch("/api/version");
                if (response.ok) {
                    const data = await response.json();
                    setVersionInfo(data);
                }
            } catch (error) {
                console.error("Failed to load version:", error);
            }
        }
        loadVersion();
    }, []);

    // Trigger native Sparkle update check (shows UI)
    const handleCheckForUpdates = () => {
        setCheckingForUpdates(true);
        triggerNativeUpdate();
        // Reset after a short delay (Sparkle UI will take over)
        setTimeout(() => setCheckingForUpdates(false), 1000);
    };

    const handleSaveSecret = async (key: string) => {
        setSavingSecret(true);
        try {
            const response = await fetch("/api/secrets/set", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key, value: secretValue }),
            });
            if (response.ok) {
                const result = await response.json();
                setSecrets((prev) =>
                    prev.map((s) =>
                        s.key === key
                            ? { ...s, hasValue: result.hasValue, maskedValue: result.maskedValue }
                            : s
                    )
                );
                setEditingSecret(null);
                setSecretValue("");
                setShowSecretValue(false);
            }
        } catch (error) {
            console.error("Failed to save secret:", error);
        } finally {
            setSavingSecret(false);
        }
    };

    const handleDeleteSecret = async (key: string, isPredefined: boolean) => {
        try {
            const response = await fetch("/api/secrets/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key }),
            });
            if (response.ok) {
                if (isPredefined) {
                    // For predefined, just clear the value
                    setSecrets((prev) =>
                        prev.map((s) =>
                            s.key === key ? { ...s, hasValue: false, maskedValue: "" } : s
                        )
                    );
                } else {
                    // For custom, remove from the list entirely
                    setSecrets((prev) => prev.filter((s) => s.key !== key));
                }
            }
        } catch (error) {
            console.error("Failed to delete secret:", error);
        }
    };

    const handleAddCustomSecret = async () => {
        // Validate key format
        if (!newSecretKey.trim()) {
            setNewSecretError("Key is required");
            return;
        }

        const formattedKey = newSecretKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        if (!/^[A-Z][A-Z0-9_]*$/.test(formattedKey)) {
            setNewSecretError("Key must start with a letter and contain only letters, numbers, and underscores");
            return;
        }

        // Check if key already exists
        if (secrets.some((s) => s.key === formattedKey)) {
            setNewSecretError("A secret with this key already exists");
            return;
        }

        if (!newSecretValue.trim()) {
            setNewSecretError("Value is required");
            return;
        }

        setSavingSecret(true);
        setNewSecretError("");

        try {
            const response = await fetch("/api/secrets/set", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: formattedKey, value: newSecretValue }),
            });

            if (response.ok) {
                const result = await response.json();
                setSecrets((prev) => [
                    ...prev,
                    {
                        key: formattedKey,
                        label: formattedKey,
                        description: "Custom API key",
                        placeholder: "",
                        helpText: "",
                        hasValue: result.hasValue,
                        maskedValue: result.maskedValue,
                        isPredefined: false,
                    },
                ]);
                setIsAddingCustom(false);
                setNewSecretKey("");
                setNewSecretValue("");
                setShowNewSecretValue(false);
            } else {
                const error = await response.json();
                setNewSecretError(error.error || "Failed to save secret");
            }
        } catch (error) {
            console.error("Failed to save custom secret:", error);
            setNewSecretError("Failed to save secret");
        } finally {
            setSavingSecret(false);
        }
    };

    // Handle keyboard recording for shortcut editing
    useEffect(() => {
        if (!editingShortcut) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const keys: string[] = [];
            if (e.metaKey) keys.push("cmd");
            if (e.ctrlKey && !e.metaKey) keys.push("ctrl");
            if (e.altKey) keys.push("alt");
            if (e.shiftKey) keys.push("shift");

            // Normalize key names
            let key = e.key.toLowerCase();
            if (key === "[" ) key = "bracketleft";
            if (key === "]" ) key = "bracketright";
            if (key === "arrowleft" ) key = "left";
            if (key === "arrowright" ) key = "right";
            if (key === "arrowup" ) key = "up";
            if (key === "arrowdown" ) key = "down";

            if (!["meta", "control", "alt", "shift"].includes(e.key.toLowerCase())) {
                keys.push(key);
            }

            if (keys.length > 0 && keys.some(k => !["cmd", "ctrl", "alt", "shift"].includes(k))) {
                setRecordingKeys(keys);
            }
        };

        const handleKeyUp = (_e: KeyboardEvent) => {
            if (recordingKeys.length > 0) {
                updateShortcut(editingShortcut, recordingKeys);
                setEditingShortcut(null);
                setRecordingKeys([]);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
        };
    }, [editingShortcut, recordingKeys, updateShortcut]);

    const categoryLabels = {
        tabs: "Tab Management",
        navigation: "Navigation",
        workspace: "Workspace",
        custom: "Custom",
        editor: "Editor (Tables)",
    };

    return (
        <div className="h-full overflow-y-auto p-6 space-y-6" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}>
            <div>
                <h1 className="text-2xl font-bold" style={{ color: currentTheme.styles.contentPrimary }}>Settings</h1>
                <p style={{ color: currentTheme.styles.contentSecondary }}>Manage your application settings and configuration.</p>
            </div>

            <Separator />

            <Tabs defaultValue="keyboard" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="keyboard">Keyboard Shortcuts</TabsTrigger>
                    <TabsTrigger value="preferences">Preferences</TabsTrigger>
                    <TabsTrigger value="theme">Theme</TabsTrigger>
                    <TabsTrigger value="secrets">API Keys</TabsTrigger>
                    <TabsTrigger value="storage">Storage</TabsTrigger>
                    <TabsTrigger value="about">About</TabsTrigger>
                </TabsList>

                <TabsContent value="keyboard">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>Keyboard Shortcuts</CardTitle>
                                    <CardDescription>Customize keyboard shortcuts for common actions</CardDescription>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={resetAllShortcuts}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Reset All
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {Object.entries(
                                shortcuts.reduce((acc, shortcut) => {
                                    if (!acc[shortcut.category]) acc[shortcut.category] = [];
                                    acc[shortcut.category]!.push(shortcut);
                                    return acc;
                                }, {} as Record<string, typeof shortcuts>)
                            ).map(([category, categoryShortcuts]) => (
                                <div key={category} className="space-y-2">
                                    <h3 className="font-medium text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                        {categoryLabels[category as keyof typeof categoryLabels] || category}
                                    </h3>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[40%]">Action</TableHead>
                                                <TableHead className="w-[30%]">Shortcut</TableHead>
                                                <TableHead className="w-[30%]">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {categoryShortcuts.map((shortcut) => {
                                                const currentKeys = shortcut.customKeys || shortcut.defaultKeys;
                                                const isCustom = !!shortcut.customKeys;
                                                const isEditing = editingShortcut === shortcut.id;
                                                const isDocOnly = 'documentationOnly' in shortcut && shortcut.documentationOnly;

                                                return (
                                                    <TableRow key={shortcut.id}>
                                                        <TableCell>
                                                            <div className="space-y-1">
                                                                <div className="font-medium">{shortcut.name}</div>
                                                                <div className="text-xs" style={{ color: currentTheme.styles.contentSecondary }}>
                                                                    {shortcut.description}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                {isEditing ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                                                            Press keys...
                                                                        </span>
                                                                        {recordingKeys.length > 0 && (
                                                                            <KeyboardIndicator keys={recordingKeys} />
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <KeyboardIndicator keys={currentKeys} />
                                                                        {isCustom && (
                                                                            <Badge variant="secondary" className="text-xs">
                                                                                Custom
                                                                            </Badge>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                {isDocOnly ? (
                                                                    <span className="text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                                                        Editor shortcut
                                                                    </span>
                                                                ) : isEditing ? (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        onClick={() => {
                                                                            setEditingShortcut(null);
                                                                            setRecordingKeys([]);
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </Button>
                                                                ) : (
                                                                    <>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() => setEditingShortcut(shortcut.id)}
                                                                        >
                                                                            Edit
                                                                        </Button>
                                                                        {isCustom && (
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                onClick={() => resetShortcut(shortcut.id)}
                                                                            >
                                                                                Reset
                                                                            </Button>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="preferences">
                    <Card>
                        <CardHeader>
                            <CardTitle>Chat Input Preferences</CardTitle>
                            <CardDescription>Customize how the chat input behaves</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base">
                                        Send message with
                                    </Label>
                                    <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                        Choose which key combination sends your message
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Select
                                        value={currentValue ? "enter" : "cmd-enter"}
                                        onValueChange={(value) => {
                                            const newValue = value === "enter";
                                            console.log("[Preferences] Selection changed to:", newValue);
                                            setPendingEnterToSend(newValue);
                                        }}
                                    >
                                        <SelectTrigger className="w-[180px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="enter">Enter</SelectItem>
                                            <SelectItem value="cmd-enter">Cmd + Enter</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {hasUnsavedChanges && (
                                <div className="flex items-center gap-2 pt-2">
                                    <Button
                                        onClick={handleSavePreference}
                                        disabled={savingPreference}
                                        size="sm"
                                    >
                                        {savingPreference ? "Saving..." : "Save"}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setPendingEnterToSend(null)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            )}
                            {savedPreference && (
                                <div className="flex items-center gap-2 pt-2">
                                    <Check className="h-4 w-4" style={{ color: currentTheme.styles.semanticSuccess }} />
                                    <span className="text-sm" style={{ color: currentTheme.styles.semanticSuccess }}>
                                        Saved successfully
                                    </span>
                                </div>
                            )}
                            <div className="pt-4 text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                Debug: Current saved value = {String(chatInputEnterToSend)}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="theme">
                    <div className="space-y-6">
                        {/* Current Theme Display */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Current Theme: {currentTheme.name}</CardTitle>
                                <CardDescription>Your active theme and color scheme</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Surface Colors */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium" style={{ color: currentTheme.styles.contentSecondary }}>Surface Colors</h4>
                                        <div className="space-y-1">
                                            {Object.entries({
                                                'Primary': currentTheme.styles.surfacePrimary,
                                                'Secondary': currentTheme.styles.surfaceSecondary,
                                                'Tertiary': currentTheme.styles.surfaceTertiary,
                                                'Accent': currentTheme.styles.surfaceAccent,
                                                'Muted': currentTheme.styles.surfaceMuted,
                                            }).map(([name, color]) => (
                                                <div key={name} className="flex items-center gap-2">
                                                    <div
                                                        className="w-8 h-8 rounded border"
                                                        style={{
                                                            backgroundColor: color,
                                                            borderColor: currentTheme.styles.borderDefault
                                                        }}
                                                    />
                                                    <span className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>{name}</span>
                                                    <code className="text-xs ml-auto" style={{ color: currentTheme.styles.contentTertiary }}>{color}</code>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Content Colors */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium" style={{ color: currentTheme.styles.contentSecondary }}>Content Colors</h4>
                                        <div className="space-y-1">
                                            {Object.entries({
                                                'Primary': currentTheme.styles.contentPrimary,
                                                'Secondary': currentTheme.styles.contentSecondary,
                                                'Tertiary': currentTheme.styles.contentTertiary,
                                                'Accent': currentTheme.styles.contentAccent,
                                            }).map(([name, color]) => (
                                                <div key={name} className="flex items-center gap-2">
                                                    <div
                                                        className="w-8 h-8 rounded border"
                                                        style={{
                                                            backgroundColor: color,
                                                            borderColor: currentTheme.styles.borderDefault
                                                        }}
                                                    />
                                                    <span className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>{name}</span>
                                                    <code className="text-xs ml-auto" style={{ color: currentTheme.styles.contentTertiary }}>{color}</code>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Semantic Colors */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium" style={{ color: currentTheme.styles.contentSecondary }}>Semantic Colors</h4>
                                        <div className="space-y-1">
                                            {Object.entries({
                                                'Primary': currentTheme.styles.semanticPrimary,
                                                'Destructive': currentTheme.styles.semanticDestructive,
                                                'Success': currentTheme.styles.semanticSuccess,
                                            }).map(([name, color]) => (
                                                <div key={name} className="flex items-center gap-2">
                                                    <div
                                                        className="w-8 h-8 rounded border"
                                                        style={{
                                                            backgroundColor: color,
                                                            borderColor: currentTheme.styles.borderDefault
                                                        }}
                                                    />
                                                    <span className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>{name}</span>
                                                    <code className="text-xs ml-auto" style={{ color: currentTheme.styles.contentTertiary }}>{color}</code>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Border Colors */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium" style={{ color: currentTheme.styles.contentSecondary }}>Border Colors</h4>
                                        <div className="space-y-1">
                                            {Object.entries({
                                                'Default': currentTheme.styles.borderDefault,
                                                'Accent': currentTheme.styles.borderAccent,
                                            }).map(([name, color]) => (
                                                <div key={name} className="flex items-center gap-2">
                                                    <div
                                                        className="w-8 h-8 rounded border-2"
                                                        style={{
                                                            backgroundColor: currentTheme.styles.surfacePrimary,
                                                            borderColor: color
                                                        }}
                                                    />
                                                    <span className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>{name}</span>
                                                    <code className="text-xs ml-auto" style={{ color: currentTheme.styles.contentTertiary }}>{color}</code>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Preset Themes */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Preset Themes</CardTitle>
                                <CardDescription>Choose from available theme presets</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-col gap-2">
                                    {themes.map((theme) => (
                                        <Button
                                            key={theme.name}
                                            onClick={() => setTheme(theme)}
                                            variant={currentTheme.name === theme.name ? "default" : "outline"}
                                            className="justify-start"
                                        >
                                            {theme.name}
                                        </Button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Custom Theme Editor (Coming Soon) */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Custom Theme Editor</CardTitle>
                                <CardDescription>Create and save your own custom themes</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                    The custom theme editor is coming soon. You'll be able to:
                                </p>
                                <ul className="list-disc list-inside mt-2 space-y-1 text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                    <li>Customize all color tokens with a color picker</li>
                                    <li>Save custom themes as presets</li>
                                    <li>Export and import theme configurations</li>
                                    <li>Preview changes in real-time</li>
                                </ul>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="secrets">
                    <div className="space-y-6">
                        {/* Predefined Secrets */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Key className="h-5 w-5" />
                                    System API Keys
                                </CardTitle>
                                <CardDescription>
                                    Required tokens for core application functionality.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {secretsLoading ? (
                                    <p style={{ color: currentTheme.styles.contentSecondary }}>Loading...</p>
                                ) : (
                                    <div className="space-y-4">
                                        {secrets.filter((s) => s.isPredefined).map((secret) => (
                                            <div
                                                key={secret.key}
                                                className="p-4 rounded-lg border"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                                    borderColor: currentTheme.styles.borderDefault,
                                                }}
                                            >
                                                <div className="flex items-start justify-between mb-2">
                                                    <div>
                                                        <h4 className="font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                                                            {secret.label}
                                                        </h4>
                                                        <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                                            {secret.description}
                                                        </p>
                                                    </div>
                                                    {secret.hasValue && (
                                                        <Badge variant="secondary" className="ml-2">
                                                            Configured
                                                        </Badge>
                                                    )}
                                                </div>

                                                {editingSecret === secret.key ? (
                                                    <div className="space-y-2">
                                                        <div className="flex gap-2">
                                                            <div className="relative flex-1">
                                                                <Input
                                                                    type={showSecretValue ? "text" : "password"}
                                                                    value={secretValue}
                                                                    onChange={(e) => setSecretValue(e.target.value)}
                                                                    placeholder={secret.placeholder}
                                                                    className="pr-10"
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                                                                    onClick={() => setShowSecretValue(!showSecretValue)}
                                                                >
                                                                    {showSecretValue ? (
                                                                        <EyeOff className="h-4 w-4" />
                                                                    ) : (
                                                                        <Eye className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleSaveSecret(secret.key)}
                                                                disabled={savingSecret}
                                                            >
                                                                <Check className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => {
                                                                    setEditingSecret(null);
                                                                    setSecretValue("");
                                                                    setShowSecretValue(false);
                                                                }}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                        <p className="text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                                            {secret.helpText}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        {secret.hasValue ? (
                                                            <>
                                                                <code
                                                                    className="text-sm px-2 py-1 rounded flex-1"
                                                                    style={{
                                                                        backgroundColor: currentTheme.styles.surfaceTertiary,
                                                                        color: currentTheme.styles.contentSecondary,
                                                                    }}
                                                                >
                                                                    {secret.maskedValue}
                                                                </code>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => {
                                                                        setEditingSecret(secret.key);
                                                                        setSecretValue("");
                                                                    }}
                                                                >
                                                                    Update
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handleDeleteSecret(secret.key, true)}
                                                                >
                                                                    Remove
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    setEditingSecret(secret.key);
                                                                    setSecretValue("");
                                                                }}
                                                            >
                                                                Add Token
                                                            </Button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Custom API Keys */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle>Custom API Keys</CardTitle>
                                        <CardDescription>
                                            Add API keys for MCP servers and other integrations. Use the key name in your MCP server config with {`\${KEY_NAME}`} syntax.
                                        </CardDescription>
                                    </div>
                                    {!isAddingCustom && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsAddingCustom(true)}
                                        >
                                            <Plus className="mr-2 h-4 w-4" />
                                            Add Key
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Add new custom secret form */}
                                {isAddingCustom && (
                                    <div
                                        className="p-4 rounded-lg border"
                                        style={{
                                            backgroundColor: currentTheme.styles.surfaceSecondary,
                                            borderColor: currentTheme.styles.borderAccent,
                                        }}
                                    >
                                        <h4 className="font-medium mb-3" style={{ color: currentTheme.styles.contentPrimary }}>
                                            New API Key
                                        </h4>
                                        <div className="space-y-3">
                                            <div className="space-y-1">
                                                <label className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                                    Key Name
                                                </label>
                                                <Input
                                                    value={newSecretKey}
                                                    onChange={(e) => {
                                                        setNewSecretKey(e.target.value);
                                                        setNewSecretError("");
                                                    }}
                                                    placeholder="e.g., LINEAR_API_KEY, OPENAI_API_KEY"
                                                    className="font-mono"
                                                />
                                                <p className="text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                                    Will be converted to uppercase. Use this name in MCP server configs.
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                                    Value
                                                </label>
                                                <div className="relative">
                                                    <Input
                                                        type={showNewSecretValue ? "text" : "password"}
                                                        value={newSecretValue}
                                                        onChange={(e) => {
                                                            setNewSecretValue(e.target.value);
                                                            setNewSecretError("");
                                                        }}
                                                        placeholder="Paste your API key here"
                                                        className="pr-10"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                                                        onClick={() => setShowNewSecretValue(!showNewSecretValue)}
                                                    >
                                                        {showNewSecretValue ? (
                                                            <EyeOff className="h-4 w-4" />
                                                        ) : (
                                                            <Eye className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                            {newSecretError && (
                                                <p className="text-sm" style={{ color: currentTheme.styles.semanticDestructive }}>
                                                    {newSecretError}
                                                </p>
                                            )}
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={handleAddCustomSecret}
                                                    disabled={savingSecret}
                                                    size="sm"
                                                >
                                                    {savingSecret ? "Saving..." : "Add Key"}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setIsAddingCustom(false);
                                                        setNewSecretKey("");
                                                        setNewSecretValue("");
                                                        setShowNewSecretValue(false);
                                                        setNewSecretError("");
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Existing custom secrets */}
                                {secrets.filter((s) => !s.isPredefined).length === 0 && !isAddingCustom ? (
                                    <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                        No custom API keys configured. Add one to use with MCP servers.
                                    </p>
                                ) : (
                                    <div className="space-y-4">
                                        {secrets.filter((s) => !s.isPredefined).map((secret) => (
                                            <div
                                                key={secret.key}
                                                className="p-4 rounded-lg border"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                                    borderColor: currentTheme.styles.borderDefault,
                                                }}
                                            >
                                                <div className="flex items-start justify-between mb-2">
                                                    <div>
                                                        <h4 className="font-medium font-mono" style={{ color: currentTheme.styles.contentPrimary }}>
                                                            {secret.key}
                                                        </h4>
                                                        <p className="text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                                            Use as {`\${${secret.key}}`} in MCP server configs
                                                        </p>
                                                    </div>
                                                </div>

                                                {editingSecret === secret.key ? (
                                                    <div className="space-y-2">
                                                        <div className="flex gap-2">
                                                            <div className="relative flex-1">
                                                                <Input
                                                                    type={showSecretValue ? "text" : "password"}
                                                                    value={secretValue}
                                                                    onChange={(e) => setSecretValue(e.target.value)}
                                                                    placeholder="Enter new value"
                                                                    className="pr-10"
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                                                                    onClick={() => setShowSecretValue(!showSecretValue)}
                                                                >
                                                                    {showSecretValue ? (
                                                                        <EyeOff className="h-4 w-4" />
                                                                    ) : (
                                                                        <Eye className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleSaveSecret(secret.key)}
                                                                disabled={savingSecret}
                                                            >
                                                                <Check className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => {
                                                                    setEditingSecret(null);
                                                                    setSecretValue("");
                                                                    setShowSecretValue(false);
                                                                }}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <code
                                                            className="text-sm px-2 py-1 rounded flex-1"
                                                            style={{
                                                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                                                color: currentTheme.styles.contentSecondary,
                                                            }}
                                                        >
                                                            {secret.maskedValue}
                                                        </code>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => {
                                                                setEditingSecret(secret.key);
                                                                setSecretValue("");
                                                            }}
                                                        >
                                                            Update
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleDeleteSecret(secret.key, false)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="storage">
                    <StorageSettings />
                </TabsContent>

                <TabsContent value="about">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Info className="h-5 w-5" />
                                About Nomendex
                            </CardTitle>
                            <CardDescription>
                                Version information and updates
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Version Info */}
                            <div
                                className="p-4 rounded-lg border"
                                style={{
                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                    borderColor: currentTheme.styles.borderDefault,
                                }}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                                            Current Version
                                        </h4>
                                        {versionInfo ? (
                                            <p className="text-sm mt-1" style={{ color: currentTheme.styles.contentSecondary }}>
                                                v{versionInfo.version} (build {versionInfo.buildNumber})
                                            </p>
                                        ) : (
                                            <p className="text-sm mt-1" style={{ color: currentTheme.styles.contentTertiary }}>
                                                Loading...
                                            </p>
                                        )}
                                    </div>
                                    <Button
                                        onClick={handleCheckForUpdates}
                                        disabled={checkingForUpdates}
                                        variant="outline"
                                    >
                                        <RefreshCw className={`mr-2 h-4 w-4 ${checkingForUpdates ? "animate-spin" : ""}`} />
                                        Check for Updates
                                    </Button>
                                </div>
                            </div>

                            {/* Update Settings Info */}
                            <div className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                <p>
                                    Nomendex automatically checks for updates every 15 minutes.
                                    When an update is available, you'll see a notification.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

export function SettingsPage() {
    return (
        <SidebarProvider>
            <div className="flex h-screen w-full overflow-hidden">
                <WorkspaceSidebar />
                <SidebarInset className="flex-1 overflow-hidden">
                    <SettingsContent />
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
