import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { chatPluginSerial } from "@/features/chat";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import {
    ArrowLeft,
    ArrowRight,
    Loader2,
    FileText,
    ChevronLeft,
    Check,
    Bot
} from "lucide-react";

interface ConflictContent {
    success: boolean;
    filePath: string;
    oursContent: string;
    theirsContent: string;
    mergedContent: string;
    error?: string;
}

// Compute Longest Common Subsequence for better diff
function computeLCS(a: string[], b: string[]): Set<string> {
    const m = a.length;
    const n = b.length;

    // Create DP table
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find LCS
    const lcs = new Set<string>();
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            lcs.add(a[i - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return lcs;
}

// Improved diff computation using LCS
function computeLineDiffs(oursLines: string[], theirsLines: string[]): {
    oursHighlights: Set<number>;
    theirsHighlights: Set<number>;
    oursOnly: Set<number>;
    theirsOnly: Set<number>;
} {
    const oursHighlights = new Set<number>();
    const theirsHighlights = new Set<number>();
    const oursOnly = new Set<number>();
    const theirsOnly = new Set<number>();

    // Find common lines using LCS
    const commonLines = computeLCS(oursLines, theirsLines);

    // Mark lines that aren't in the common set
    oursLines.forEach((line, i) => {
        if (!commonLines.has(line)) {
            oursHighlights.add(i);
            oursOnly.add(i);
        }
    });

    theirsLines.forEach((line, i) => {
        if (!commonLines.has(line)) {
            theirsHighlights.add(i);
            theirsOnly.add(i);
        }
    });

    return { oursHighlights, theirsHighlights, oursOnly, theirsOnly };
}

function CodePanel(props: {
    title: string;
    subtitle: string;
    content: string;
    highlightedLines: Set<number>;
    uniqueLines: Set<number>;
    variant: "ours" | "theirs";
    diffCount: number;
}) {
    const { title, subtitle, content, highlightedLines, uniqueLines, variant, diffCount } = props;
    const lines = content.split("\n");

    const bgColor = variant === "ours" ? "bg-blue-500/5" : "bg-green-500/5";
    const highlightColor = variant === "ours" ? "bg-red-500/15" : "bg-green-500/15";
    const highlightBorder = variant === "ours" ? "border-l-2 border-l-red-500" : "border-l-2 border-l-green-500";
    const borderColor = variant === "ours" ? "border-blue-500/20" : "border-green-500/20";

    return (
        <div className={`flex-1 flex flex-col border rounded-lg overflow-hidden ${borderColor}`}>
            <div className={`px-3 py-2 border-b ${bgColor} ${borderColor}`}>
                <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{title}</span>
                    <div className="flex items-center gap-2">
                        {diffCount > 0 && (
                            <Badge variant={variant === "ours" ? "destructive" : "default"} className="text-xs">
                                {diffCount} {variant === "ours" ? "removed" : "added"}
                            </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                            {lines.length} lines
                        </Badge>
                    </div>
                </div>
                <span className="text-xs text-muted-foreground">{subtitle}</span>
            </div>
            <div className="flex-1 overflow-auto font-mono text-xs">
                {lines.length === 0 || (lines.length === 1 && lines[0] === "") ? (
                    <div className="p-4 text-muted-foreground italic">
                        (File does not exist in this version)
                    </div>
                ) : (
                    <table className="w-full border-collapse">
                        <tbody>
                            {lines.map((line, i) => {
                                const isHighlighted = highlightedLines.has(i);
                                const isUnique = uniqueLines.has(i);
                                return (
                                    <tr
                                        key={i}
                                        className={isHighlighted ? `${highlightColor} ${highlightBorder}` : ""}
                                    >
                                        <td className={`px-2 py-0.5 text-right select-none border-r w-10 sticky left-0 ${isHighlighted ? (variant === "ours" ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-600") : "bg-muted/50 text-muted-foreground"}`}>
                                            {isUnique && (variant === "ours" ? "-" : "+")}
                                            {i + 1}
                                        </td>
                                        <td className={`px-2 py-0.5 whitespace-pre overflow-x-auto ${isHighlighted ? (variant === "ours" ? "text-red-700" : "text-green-700") : ""}`}>
                                            {line || " "}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function ConflictResolveContent() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { addNewTab, setActiveTabId } = useWorkspaceContext();
    const filePath = searchParams.get("path") || "";

    const [content, setContent] = useState<ConflictContent | null>(null);
    const [loading, setLoading] = useState(true);
    const [resolving, setResolving] = useState(false);
    const [error, setError] = useState("");
    const [resolved, setResolved] = useState(false);

    const solveWithAgent = async () => {
        if (!content) return;

        const prompt = `I have a merge conflict in the file "${filePath}" that I need help resolving.

## Our Version (Local)
\`\`\`
${content.oursContent}
\`\`\`

## Their Version (Remote)
\`\`\`
${content.theirsContent}
\`\`\`

Please analyze both versions and create a merged version that combines the important changes from both. Explain what changes you're keeping and why. Then provide the final merged content that I should use.

After you provide the merged content, I will manually update the file and mark the conflict as resolved.`;

        const newTab = await addNewTab({
            pluginMeta: chatPluginSerial,
            view: "chat",
            props: { initialPrompt: prompt },
        });

        if (newTab) {
            setActiveTabId(newTab.id);
            navigate("/");
        }
    };

    useEffect(() => {
        async function loadContent() {
            if (!filePath) {
                setError("No file path specified");
                setLoading(false);
                return;
            }

            try {
                const response = await fetch(`/api/git/conflict-content?path=${encodeURIComponent(filePath)}`);
                if (response.ok) {
                    const data: ConflictContent = await response.json();
                    setContent(data);
                } else {
                    const data = await response.json();
                    setError(data.error || "Failed to load conflict content");
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load conflict content");
            } finally {
                setLoading(false);
            }
        }

        loadContent();
    }, [filePath]);

    const resolveConflict = async (resolution: "ours" | "theirs") => {
        try {
            setResolving(true);
            setError("");

            const response = await fetch("/api/git/resolve-conflict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath, resolution }),
            });

            if (response.ok) {
                setResolved(true);
                // Navigate back after a brief delay
                setTimeout(() => navigate("/sync"), 1000);
            } else {
                const data = await response.json();
                setError(data.error || "Failed to resolve conflict");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to resolve conflict");
        } finally {
            setResolving(false);
        }
    };

    // Compute line diffs
    const { oursHighlights, theirsHighlights, oursOnly, theirsOnly } = useMemo(() => {
        if (!content) return {
            oursHighlights: new Set<number>(),
            theirsHighlights: new Set<number>(),
            oursOnly: new Set<number>(),
            theirsOnly: new Set<number>()
        };

        const oursLines = content.oursContent.split("\n");
        const theirsLines = content.theirsContent.split("\n");

        return computeLineDiffs(oursLines, theirsLines);
    }, [content]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (resolved) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10">
                    <Check className="h-6 w-6 text-green-500" />
                </div>
                <p className="text-sm text-muted-foreground">Conflict resolved! Redirecting...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/sync")}
                    className="gap-1"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                </Button>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-mono text-sm truncate">{filePath}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Compare versions and choose which to keep
                    </p>
                </div>

                {/* Resolve Buttons */}
                <div className="flex gap-2 flex-shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={solveWithAgent}
                        disabled={resolving || !content}
                        className="gap-1"
                    >
                        <Bot className="h-4 w-4" />
                        Solve with Agent
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resolveConflict("ours")}
                        disabled={resolving || !content}
                        className="gap-1"
                    >
                        {resolving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <ArrowLeft className="h-4 w-4" />
                                Keep Ours
                            </>
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resolveConflict("theirs")}
                        disabled={resolving || !content}
                        className="gap-1"
                    >
                        {resolving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                Keep Theirs
                                <ArrowRight className="h-4 w-4" />
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-4 mt-4 px-3 py-2 text-sm bg-destructive/10 text-destructive border border-destructive/20 rounded-md">
                    {error}
                </div>
            )}

            {/* Diff Summary */}
            {content && (oursOnly.size > 0 || theirsOnly.size > 0) && (
                <div className="mx-4 mt-4 px-3 py-2 text-sm bg-amber-500/10 border border-amber-500/20 rounded-md">
                    <span className="font-medium">Differences found: </span>
                    {oursOnly.size > 0 && (
                        <span className="text-red-600">{oursOnly.size} line{oursOnly.size !== 1 ? "s" : ""} only in local</span>
                    )}
                    {oursOnly.size > 0 && theirsOnly.size > 0 && <span>, </span>}
                    {theirsOnly.size > 0 && (
                        <span className="text-green-600">{theirsOnly.size} line{theirsOnly.size !== 1 ? "s" : ""} only in remote</span>
                    )}
                </div>
            )}

            {/* No differences warning */}
            {content && oursOnly.size === 0 && theirsOnly.size === 0 && (
                <div className="mx-4 mt-4 px-3 py-2 text-sm bg-muted border rounded-md space-y-2">
                    <span className="text-muted-foreground">No differences detected between extracted versions.</span>
                    {content.mergedContent.includes("<<<<<<<") && (
                        <div className="text-amber-600 text-xs">
                            The file contains conflict markers. View the raw file below to see the conflict.
                        </div>
                    )}
                </div>
            )}

            {/* Show merged content with markers if present */}
            {content && content.mergedContent.includes("<<<<<<<") && (
                <div className="mx-4 mt-2">
                    <details className="border rounded-lg overflow-hidden">
                        <summary className="px-3 py-2 bg-amber-500/10 border-b cursor-pointer text-sm font-medium hover:bg-amber-500/20">
                            View file with conflict markers
                        </summary>
                        <div className="font-mono text-xs overflow-auto max-h-64 p-2 bg-muted/30">
                            <pre className="whitespace-pre-wrap">{content.mergedContent}</pre>
                        </div>
                    </details>
                </div>
            )}

            {/* Diff View */}
            {content && (
                <div className="flex-1 flex gap-4 p-4 overflow-hidden min-h-0">
                    <CodePanel
                        title="Ours (Local)"
                        subtitle="Your local version"
                        content={content.oursContent}
                        highlightedLines={oursHighlights}
                        uniqueLines={oursOnly}
                        variant="ours"
                        diffCount={oursOnly.size}
                    />
                    <CodePanel
                        title="Theirs (Remote)"
                        subtitle="Incoming from remote"
                        content={content.theirsContent}
                        highlightedLines={theirsHighlights}
                        uniqueLines={theirsOnly}
                        variant="theirs"
                        diffCount={theirsOnly.size}
                    />
                </div>
            )}
        </div>
    );
}

export function ConflictResolvePage() {
    return (
        <SidebarProvider>
            <div className="flex h-screen w-full overflow-hidden">
                <WorkspaceSidebar />
                <SidebarInset className="flex flex-col overflow-hidden">
                    <ConflictResolveContent />
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
