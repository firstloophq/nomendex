"use client";

import { useTheme } from "@/hooks/useTheme";
import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface RenderedUIProps {
    html: string;
    title?: string;
    height?: number;
    allowSameOrigin?: boolean;
    className?: string;
}

// Convert camelCase to kebab-case for CSS variable names
function toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

// Logging helper for debugging render_ui issues
function logRenderUI(message: string, data?: Record<string, unknown>) {
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
export function RenderedUI({ html, title, height, allowSameOrigin, className }: RenderedUIProps) {
    const { currentTheme } = useTheme();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [iframeHeight, setIframeHeight] = useState(height || 200);
    const [error, setError] = useState<string | null>(null);

    logRenderUI("Rendering UI component", {
        htmlLength: html?.length ?? 0,
        title,
        height,
        allowSameOrigin,
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
                    sandbox={allowSameOrigin ? "allow-scripts allow-forms allow-same-origin" : "allow-scripts allow-forms"}
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
    allowSameOrigin?: boolean;
}

// MCP content block format
interface McpContentBlock {
    type: string;
    text?: string;
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

export function isNoetectUIData(output: unknown): output is NoetectUIData {
    // Direct object check
    if (isNoetectUIDataObject(output)) {
        return true;
    }

    // JSON string check
    if (typeof output === "string") {
        try {
            const parsed = JSON.parse(output);
            return isNoetectUIDataObject(parsed);
        } catch {
            return false;
        }
    }

    // MCP content array format: [{ type: "text", text: "{...}" }]
    if (Array.isArray(output) && output.length > 0) {
        const firstBlock = output[0] as McpContentBlock;
        if (firstBlock?.type === "text" && typeof firstBlock.text === "string") {
            try {
                const parsed = JSON.parse(firstBlock.text);
                return isNoetectUIDataObject(parsed);
            } catch {
                return false;
            }
        }
    }

    return false;
}

export function parseNoetectUIData(output: unknown): NoetectUIData | null {
    logRenderUI("Parsing tool output", {
        type: typeof output,
        isArray: Array.isArray(output),
        preview: typeof output === "string" ? output.substring(0, 100) : JSON.stringify(output)?.substring(0, 100)
    });

    // Direct object
    if (isNoetectUIDataObject(output)) {
        logRenderUI("Parsed as direct object");
        return output;
    }

    // JSON string
    if (typeof output === "string") {
        try {
            const parsed = JSON.parse(output);
            if (isNoetectUIDataObject(parsed)) {
                logRenderUI("Parsed from JSON string");
                return parsed;
            }
            logRenderUI("JSON parsed but not NoetectUIData", { parsed });
        } catch (e) {
            logRenderUI("Failed to parse JSON string", { error: String(e) });
            return null;
        }
    }

    // MCP content array format: [{ type: "text", text: "{...}" }]
    if (Array.isArray(output) && output.length > 0) {
        logRenderUI("Checking MCP content array format", { length: output.length });
        const firstBlock = output[0] as McpContentBlock;
        if (firstBlock?.type === "text" && typeof firstBlock.text === "string") {
            try {
                const parsed = JSON.parse(firstBlock.text);
                if (isNoetectUIDataObject(parsed)) {
                    logRenderUI("Parsed from MCP content array");
                    return parsed;
                }
                logRenderUI("MCP content parsed but not NoetectUIData", { parsed });
            } catch (e) {
                logRenderUI("Failed to parse MCP content text", { error: String(e), text: firstBlock.text?.substring(0, 100) });
                return null;
            }
        } else {
            logRenderUI("MCP content array first block not text type", { firstBlock });
        }
    }

    logRenderUI("Could not parse as NoetectUIData");
    return null;
}
