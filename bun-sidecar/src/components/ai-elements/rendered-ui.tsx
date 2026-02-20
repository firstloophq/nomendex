"use client";

import { useTheme } from "@/hooks/useTheme";
import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface RenderedUIProps {
    html: string;
    title?: string;
    height?: number;
    className?: string;
}

// Convert camelCase to kebab-case for CSS variable names
function toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

// Logging helper for debugging render_ui issues
function logRenderUI(message: string, data?: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("debug:render-ui") !== "1") return;
    console.log(`[RenderedUI] ${message}`, data ?? "");
}

/**
 * Renders custom HTML from skills in a sandboxed iframe.
 *
 * Security:
 * - Uses sandbox attribute to restrict iframe capabilities
 * - No allow-same-origin prevents access to parent window's storage/cookies
 * - allow-scripts enables JavaScript within the iframe
 * - allow-forms enables form submission within the iframe
 *
 * Theme Integration:
 * - All theme values are exposed as CSS variables (e.g., var(--surface-primary))
 * - Skills can use these variables in their CSS for consistent theming
 * - The iframe re-renders when the theme changes
 */
export function RenderedUI({ html, title, height, className }: RenderedUIProps) {
    const { currentTheme } = useTheme();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [iframeHeight, setIframeHeight] = useState(height || 200);
    const [error, setError] = useState<string | null>(null);

    logRenderUI("Rendering UI component", {
        htmlLength: html?.length ?? 0,
        title,
        height,
        hasHtml: !!html
    });

    // Generate CSS variables from theme
    const cssVariables = Object.entries(currentTheme.styles)
        .map(([key, value]) => `--${toKebabCase(key)}: ${value};`)
        .join("\n            ");

    // Handle iframe load errors
    const handleError = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
        const errorMsg = "Failed to load rendered UI iframe";
        logRenderUI("Iframe error", { event: event.type, target: event.currentTarget.src });
        setError(errorMsg);
    }, []);

    // Handle successful iframe load
    const handleLoad = useCallback(() => {
        logRenderUI("Iframe loaded successfully");
        setError(null);
    }, []);

    // Wrap the HTML with basic styling that matches the theme
    const wrappedHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root {
            /* Theme CSS Variables - use these in your styles! */
            ${cssVariables}
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: var(--content-primary);
            background: transparent;
        }
        a {
            color: var(--semantic-primary);
        }
        button {
            cursor: pointer;
            padding: 6px 12px;
            border-radius: var(--border-radius);
            border: 1px solid var(--border-default);
            background: var(--surface-secondary);
            color: var(--content-primary);
            font-size: 13px;
            transition: background 0.15s ease;
        }
        button:hover {
            background: var(--surface-muted);
        }
        button.primary {
            background: var(--semantic-primary);
            color: var(--semantic-primary-foreground);
            border-color: var(--semantic-primary);
        }
        button.primary:hover {
            opacity: 0.9;
        }
        button.destructive {
            background: var(--semantic-destructive);
            color: var(--semantic-destructive-foreground);
            border-color: var(--semantic-destructive);
        }
        input, select, textarea {
            padding: 6px 10px;
            border-radius: var(--border-radius);
            border: 1px solid var(--border-default);
            background: var(--surface-primary);
            color: var(--content-primary);
            font-size: 13px;
            transition: border-color 0.15s ease;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--semantic-primary);
        }
        input::placeholder, textarea::placeholder {
            color: var(--content-tertiary);
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--border-default);
        }
        th {
            font-weight: 600;
            color: var(--content-secondary);
        }
        code {
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
            font-size: 12px;
            padding: 2px 4px;
            border-radius: 4px;
            background: var(--surface-muted);
        }
        pre {
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
            font-size: 12px;
            padding: 12px;
            border-radius: var(--border-radius);
            background: var(--surface-muted);
            overflow-x: auto;
        }
        pre code {
            padding: 0;
            background: none;
        }
        /* Utility classes */
        .card {
            background: var(--surface-secondary);
            border: 1px solid var(--border-default);
            border-radius: var(--border-radius);
            padding: 16px;
        }
        .text-primary { color: var(--content-primary); }
        .text-secondary { color: var(--content-secondary); }
        .text-muted { color: var(--content-tertiary); }
        .text-accent { color: var(--content-accent); }
        .text-success { color: var(--semantic-success); }
        .text-destructive { color: var(--semantic-destructive); }
        .bg-primary { background: var(--surface-primary); }
        .bg-secondary { background: var(--surface-secondary); }
        .bg-muted { background: var(--surface-muted); }
    </style>
</head>
<body>
${html}
<script>
    // Auto-resize iframe to content height
    function updateHeight() {
        const height = document.body.scrollHeight;
        window.parent.postMessage({ type: 'noetect-ui-resize', height }, '*');
    }

    // Update on load and when content changes
    updateHeight();
    new MutationObserver(updateHeight).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
    });

    // Also update on window resize
    window.addEventListener('resize', updateHeight);
</script>
</body>
</html>
`;

    // Listen for resize messages from the iframe
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === "noetect-ui-resize" && typeof event.data.height === "number") {
                // Only update if this message is from our iframe
                if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
                    setIframeHeight(Math.max(event.data.height + 4, 50)); // +4 for padding, min 50px
                }
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    // Show error state if HTML is missing or invalid
    if (!html) {
        logRenderUI("No HTML content provided");
        return (
            <div
                className={cn("rounded-lg p-4 text-sm", className)}
                style={{
                    backgroundColor: `${currentTheme.styles.semanticDestructive}1a`,
                    color: currentTheme.styles.semanticDestructive,
                    border: `1px solid ${currentTheme.styles.semanticDestructive}`,
                }}
            >
                <strong>[RenderedUI Error]</strong> No HTML content provided to render_ui tool.
            </div>
        );
    }

    return (
        <div className={cn("rounded-lg overflow-hidden border", className)} style={{ borderColor: currentTheme.styles.borderDefault }}>
            {title && (
                <div
                    className="px-3 py-2 text-xs font-medium border-b"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        color: currentTheme.styles.contentSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    {title}
                </div>
            )}
            {error ? (
                <div
                    className="p-4 text-sm"
                    style={{
                        backgroundColor: `${currentTheme.styles.semanticDestructive}1a`,
                        color: currentTheme.styles.semanticDestructive,
                    }}
                >
                    <strong>[RenderedUI Error]</strong> {error}
                    <pre className="mt-2 text-xs opacity-70 overflow-auto max-h-32">
                        HTML preview: {html.substring(0, 200)}...
                    </pre>
                </div>
            ) : (
                <iframe
                    ref={iframeRef}
                    srcDoc={wrappedHtml}
                    sandbox="allow-scripts allow-forms"
                    className="w-full border-0"
                    style={{
                        height: height || iframeHeight,
                        backgroundColor: currentTheme.styles.surfacePrimary,
                    }}
                    title={title || "Rendered UI"}
                    onError={handleError}
                    onLoad={handleLoad}
                />
            )}
        </div>
    );
}

/**
 * Type guard to check if tool output contains rendered UI data
 */
export interface NoetectUIData {
    __noetect_ui: true;
    html: string;
    title?: string;
    height?: number;
}

// MCP content block format
interface McpContentBlock {
    type?: unknown;
    text?: unknown;
    content?: unknown;
}

function isNoetectUIDataObject(obj: unknown): obj is NoetectUIData {
    return (
        obj !== null &&
        typeof obj === "object" &&
        "__noetect_ui" in obj &&
        (obj as NoetectUIData).__noetect_ui === true &&
        "html" in obj &&
        typeof (obj as NoetectUIData).html === "string"
    );
}

function looksLikeJsonPayload(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return (
        trimmed.startsWith("{") ||
        trimmed.startsWith("[") ||
        trimmed.startsWith("```") ||
        trimmed.includes("__noetect_ui")
    );
}

function parseJsonCandidates(raw: string): unknown | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const candidates: string[] = [trimmed];
    const fullFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fullFenceMatch?.[1]) {
        candidates.push(fullFenceMatch[1].trim());
    }
    const inlineFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (inlineFenceMatch?.[1]) {
        candidates.push(inlineFenceMatch[1].trim());
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
    }

    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);

        try {
            const parsed = JSON.parse(candidate);
            if (typeof parsed === "string" && looksLikeJsonPayload(parsed)) {
                try {
                    return JSON.parse(parsed);
                } catch {
                    // Keep the first parsed string if nested JSON parse fails.
                }
            }
            return parsed;
        } catch {
            // Try next candidate.
        }
    }

    return null;
}

export function isNoetectUIData(output: unknown): output is NoetectUIData {
    return parseNoetectUIData(output) !== null;
}

export function parseNoetectUIData(output: unknown): NoetectUIData | null {
    const queue: unknown[] = [output];
    const seenObjects = new Set<object>();

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === null || current === undefined) {
            continue;
        }

        if (isNoetectUIDataObject(current)) {
            return current;
        }

        if (typeof current === "string") {
            if (!looksLikeJsonPayload(current)) {
                continue;
            }
            const parsed = parseJsonCandidates(current);
            if (parsed !== null) {
                queue.push(parsed);
            }
            continue;
        }

        if (Array.isArray(current)) {
            queue.push(...current);
            continue;
        }

        if (typeof current === "object") {
            if (seenObjects.has(current)) {
                continue;
            }
            seenObjects.add(current);

            const block = current as McpContentBlock;
            if (typeof block.text === "string") {
                queue.push(block.text);
            }
            if ("content" in block) {
                queue.push(block.content);
            }
        }
    }

    return null;
}
