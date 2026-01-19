import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useTheme } from "@/hooks/useTheme";
import { CalendarDays, Tag, Clock, FileText, ListTodo } from "lucide-react";

function HelpContent() {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    return (
        <div
            className="flex-1 overflow-y-auto p-6"
            style={{ backgroundColor: styles.surfacePrimary }}
        >
            <div className="max-w-3xl mx-auto space-y-8">
                <div>
                    <h1
                        className="text-3xl font-bold mb-2"
                        style={{ color: styles.contentPrimary }}
                    >
                        Help
                    </h1>
                    <p
                        className="text-lg"
                        style={{ color: styles.contentSecondary }}
                    >
                        Learn how to use the app's features effectively.
                    </p>
                </div>

                {/* Todos Section */}
                <Card style={{ backgroundColor: styles.surfaceSecondary, borderColor: styles.borderDefault }}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2" style={{ color: styles.contentPrimary }}>
                            <ListTodo className="size-5" />
                            Todos
                        </CardTitle>
                        <CardDescription style={{ color: styles.contentSecondary }}>
                            Task management with kanban boards, projects, and more.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Due Dates */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2" style={{ color: styles.contentPrimary }}>
                                <CalendarDays className="size-4" />
                                Due Dates
                            </h3>
                            <p className="text-sm" style={{ color: styles.contentSecondary }}>
                                Set due dates for your todos using natural language. Click the calendar icon in the todo dialog and type phrases like:
                            </p>
                            <div
                                className="rounded-lg p-4 space-y-2"
                                style={{ backgroundColor: styles.surfaceTertiary }}
                            >
                                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                                    <code style={{ color: styles.contentPrimary }}>today</code>
                                    <span style={{ color: styles.contentSecondary }}>Today's date</span>

                                    <code style={{ color: styles.contentPrimary }}>tomorrow</code>
                                    <span style={{ color: styles.contentSecondary }}>Tomorrow's date</span>

                                    <code style={{ color: styles.contentPrimary }}>yesterday</code>
                                    <span style={{ color: styles.contentSecondary }}>Yesterday's date</span>

                                    <code style={{ color: styles.contentPrimary }}>next wed</code>
                                    <span style={{ color: styles.contentSecondary }}>Next Wednesday</span>

                                    <code style={{ color: styles.contentPrimary }}>last fri</code>
                                    <span style={{ color: styles.contentSecondary }}>Last Friday</span>

                                    <code style={{ color: styles.contentPrimary }}>next week</code>
                                    <span style={{ color: styles.contentSecondary }}>7 days from now</span>

                                    <code style={{ color: styles.contentPrimary }}>1/15</code>
                                    <span style={{ color: styles.contentSecondary }}>January 15th (current year)</span>

                                    <code style={{ color: styles.contentPrimary }}>1/15/2026</code>
                                    <span style={{ color: styles.contentSecondary }}>January 15th, 2026</span>
                                </div>
                            </div>
                            <p className="text-sm" style={{ color: styles.contentTertiary }}>
                                Tip: You can abbreviate — "ne wed", "tom", "yest" all work!
                            </p>
                        </div>

                        {/* Tags */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2" style={{ color: styles.contentPrimary }}>
                                <Tag className="size-4" />
                                Tags
                            </h3>
                            <p className="text-sm" style={{ color: styles.contentSecondary }}>
                                Organize todos with tags. Click the tag icon to add tags. Previously used tags appear as suggestions for quick selection.
                            </p>
                        </div>

                        {/* Status */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2" style={{ color: styles.contentPrimary }}>
                                <Clock className="size-4" />
                                Status
                            </h3>
                            <p className="text-sm" style={{ color: styles.contentSecondary }}>
                                Todos have four statuses that map to kanban columns:
                            </p>
                            <ul className="text-sm space-y-1 ml-4" style={{ color: styles.contentSecondary }}>
                                <li><strong>Todo</strong> — Tasks to be done</li>
                                <li><strong>In Progress</strong> — Currently working on</li>
                                <li><strong>Done</strong> — Completed tasks</li>
                                <li><strong>Later</strong> — Deferred tasks (toggle column visibility in view)</li>
                            </ul>
                        </div>

                        {/* Kanban Shortcuts */}
                        <div className="space-y-3">
                            <h3 className="font-semibold" style={{ color: styles.contentPrimary }}>
                                Kanban Shortcuts
                            </h3>
                            <p className="text-sm" style={{ color: styles.contentSecondary }}>
                                Navigate and manage todos quickly in the kanban view:
                            </p>
                            <div
                                className="rounded-lg p-4 space-y-2"
                                style={{ backgroundColor: styles.surfaceTertiary }}
                            >
                                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                                    <code style={{ color: styles.contentPrimary }}>Arrow keys</code>
                                    <span style={{ color: styles.contentSecondary }}>Navigate between todos</span>

                                    <code style={{ color: styles.contentPrimary }}>Shift + Arrow keys</code>
                                    <span style={{ color: styles.contentSecondary }}>Move todo (reorder/change column)</span>

                                    <code style={{ color: styles.contentPrimary }}>Enter</code>
                                    <span style={{ color: styles.contentSecondary }}>Open selected todo</span>

                                    <code style={{ color: styles.contentPrimary }}>c</code>
                                    <span style={{ color: styles.contentSecondary }}>Create new todo</span>

                                    <code style={{ color: styles.contentPrimary }}>;</code>
                                    <span style={{ color: styles.contentSecondary }}>Copy todo (title & description)</span>

                                    <code style={{ color: styles.contentPrimary }}>a</code>
                                    <span style={{ color: styles.contentSecondary }}>Archive selected todo</span>

                                    <code style={{ color: styles.contentPrimary }}>Delete / Backspace</code>
                                    <span style={{ color: styles.contentSecondary }}>Delete selected todo</span>

                                    <code style={{ color: styles.contentPrimary }}>/</code>
                                    <span style={{ color: styles.contentSecondary }}>Focus search</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Notes Section */}
                <Card style={{ backgroundColor: styles.surfaceSecondary, borderColor: styles.borderDefault }}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2" style={{ color: styles.contentPrimary }}>
                            <FileText className="size-5" />
                            Notes
                        </CardTitle>
                        <CardDescription style={{ color: styles.contentSecondary }}>
                            Markdown notes with daily note support.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Daily Notes */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2" style={{ color: styles.contentPrimary }}>
                                <CalendarDays className="size-4" />
                                Daily Notes
                            </h3>
                            <p className="text-sm" style={{ color: styles.contentSecondary }}>
                                Quick access to daily notes via the command palette (<code className="px-1 py-0.5 rounded" style={{ backgroundColor: styles.surfaceTertiary }}>Cmd+K</code>):
                            </p>
                            <ul className="text-sm space-y-1 ml-4" style={{ color: styles.contentSecondary }}>
                                <li><strong>Open Today's Daily Note</strong> — Creates if missing</li>
                                <li><strong>Open Yesterday's Daily Note</strong></li>
                                <li><strong>Open Tomorrow's Daily Note</strong></li>
                                <li><strong>Open Daily Note...</strong> — Pick any date with the same natural language input</li>
                            </ul>
                        </div>
                    </CardContent>
                </Card>

                {/* Keyboard Shortcuts */}
                <Card style={{ backgroundColor: styles.surfaceSecondary, borderColor: styles.borderDefault }}>
                    <CardHeader>
                        <CardTitle style={{ color: styles.contentPrimary }}>
                            Keyboard Shortcuts
                        </CardTitle>
                        <CardDescription style={{ color: styles.contentSecondary }}>
                            Essential shortcuts for quick navigation.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div
                            className="rounded-lg p-4 space-y-2"
                            style={{ backgroundColor: styles.surfaceTertiary }}
                        >
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                                <code style={{ color: styles.contentPrimary }}>Cmd+K</code>
                                <span style={{ color: styles.contentSecondary }}>Open command palette</span>

                                <code style={{ color: styles.contentPrimary }}>Cmd+Enter</code>
                                <span style={{ color: styles.contentSecondary }}>Submit/confirm in dialogs</span>

                                <code style={{ color: styles.contentPrimary }}>Cmd+W</code>
                                <span style={{ color: styles.contentSecondary }}>Close current tab</span>

                                <code style={{ color: styles.contentPrimary }}>Cmd+S</code>
                                <span style={{ color: styles.contentSecondary }}>Save current note</span>
                            </div>
                        </div>
                        <p className="text-sm mt-3" style={{ color: styles.contentTertiary }}>
                            Customize shortcuts in Settings → Keyboard Shortcuts.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export function HelpPage() {
    return (
        <SidebarProvider>
            <div className="flex h-screen w-full overflow-hidden">
                <WorkspaceSidebar />
                <SidebarInset className="flex-1 overflow-hidden">
                    <HelpContent />
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
