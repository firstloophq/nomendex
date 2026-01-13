"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

// Type for the native macOS WebKit message handlers
interface WebKitMessageHandlers {
    setNativeTheme?: {
        postMessage: (data: { backgroundColor: string; themeName: string }) => void;
    };
    startWindowDrag?: {
        postMessage: (data: Record<string, never>) => void;
    };
    triggerAppUpdate?: {
        postMessage: (data: Record<string, never>) => void;
    };
    checkForUpdatesInBackground?: {
        postMessage: (data: Record<string, never>) => void;
    };
}

declare global {
    interface Window {
        webkit?: {
            messageHandlers?: WebKitMessageHandlers;
        };
    }
}

/**
 * Notifies the native macOS app of theme changes for title bar styling
 */
function notifyNativeTheme(backgroundColor: string, themeName: string) {
    if (window.webkit?.messageHandlers?.setNativeTheme) {
        window.webkit.messageHandlers.setNativeTheme.postMessage({
            backgroundColor,
            themeName,
        });
    }
}

/**
 * Starts native window drag operation (for custom title bar)
 * Call this on mousedown events in draggable title bar regions
 */
export function startNativeWindowDrag() {
    if (window.webkit?.messageHandlers?.startWindowDrag) {
        window.webkit.messageHandlers.startWindowDrag.postMessage({});
    }
}

export type Theme = {
    name: string;
    styles: {
        // Surface colors (backgrounds)
        surfacePrimary: string;
        surfaceSecondary: string;
        surfaceTertiary: string;
        surfaceAccent: string;
        surfaceMuted: string;

        // Content colors (text)
        contentPrimary: string;
        contentSecondary: string;
        contentTertiary: string;
        contentAccent: string;

        // Border colors
        borderDefault: string;
        borderAccent: string;

        // Semantic colors
        semanticPrimary: string;
        semanticPrimaryForeground: string;
        semanticDestructive: string;
        semanticDestructiveForeground: string;
        semanticSuccess: string;
        semanticSuccessForeground: string;

        // Design tokens
        borderRadius: string;
        shadowSm: string;
        shadowMd: string;
        shadowLg: string;
    };
};

interface ThemeContextType {
    currentTheme: Theme;
    setTheme: (theme: Theme) => void;
    themes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
}

const themes: Theme[] = [
    {
        name: "Light",
        styles: {
            // Surface colors
            surfacePrimary: "#ffffff",
            surfaceSecondary: "#f9fafb",
            surfaceTertiary: "#f3f4f6",
            surfaceAccent: "#f3f4f6",
            surfaceMuted: "#f9fafb",

            // Content colors
            contentPrimary: "#0a0a0a",
            contentSecondary: "#525252",
            contentTertiary: "#a3a3a3",
            contentAccent: "#3b82f6",

            // Border colors
            borderDefault: "#e5e7eb",
            borderAccent: "#3b82f6",

            // Semantic colors
            semanticPrimary: "#0a0a0a",
            semanticPrimaryForeground: "#ffffff",
            semanticDestructive: "#dc2626",
            semanticDestructiveForeground: "#ffffff",
            semanticSuccess: "#16a34a",
            semanticSuccessForeground: "#ffffff",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
        },
    },
    {
        name: "Dark",
        styles: {
            // Surface colors - softer, less intense blacks
            surfacePrimary: "#1a1a1a",
            surfaceSecondary: "#252525",
            surfaceTertiary: "#2f2f2f",
            surfaceAccent: "#3a3a3a",
            surfaceMuted: "#232323",

            // Content colors - improved readability with higher contrast
            contentPrimary: "#f5f5f5",
            contentSecondary: "#c9c9c9",
            contentTertiary: "#9a9a9a",
            contentAccent: "#60a5fa",

            // Border colors - subtle with accent
            borderDefault: "#3a3a3a",
            borderAccent: "#60a5fa",

            // Semantic colors - vibrant accents
            semanticPrimary: "#60a5fa",
            semanticPrimaryForeground: "#ffffff",
            semanticDestructive: "#f87171",
            semanticDestructiveForeground: "#ffffff",
            semanticSuccess: "#34d399",
            semanticSuccessForeground: "#ffffff",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.1)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.4)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
        },
    },
    {
        name: "Nord",
        styles: {
            // Surface colors - inspired by Nord theme
            surfacePrimary: "#2e3440",
            surfaceSecondary: "#3b4252",
            surfaceTertiary: "#434c5e",
            surfaceAccent: "#4c566a",
            surfaceMuted: "#3b4252",

            // Content colors - softer off-white instead of pure white
            contentPrimary: "#e5e9f0",
            contentSecondary: "#d8dee9",
            contentTertiary: "#81a1c1",
            contentAccent: "#88c0d0",

            // Border colors
            borderDefault: "#4c566a",
            borderAccent: "#88c0d0",

            // Semantic colors - Nord palette
            semanticPrimary: "#88c0d0",
            semanticPrimaryForeground: "#2e3440",
            semanticDestructive: "#bf616a",
            semanticDestructiveForeground: "#e5e9f0",
            semanticSuccess: "#a3be8c",
            semanticSuccessForeground: "#2e3440",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.2)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.4)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
        },
    },
    {
        name: "Dracula",
        styles: {
            // Surface colors - Dracula theme
            surfacePrimary: "#282a36",
            surfaceSecondary: "#343746",
            surfaceTertiary: "#44475a",
            surfaceAccent: "#6272a4",
            surfaceMuted: "#343746",

            // Content colors
            contentPrimary: "#f8f8f2",
            contentSecondary: "#bd93f9",
            contentTertiary: "#6272a4",
            contentAccent: "#8be9fd",

            // Border colors
            borderDefault: "#44475a",
            borderAccent: "#bd93f9",

            // Semantic colors - Dracula vibrant
            semanticPrimary: "#bd93f9",
            semanticPrimaryForeground: "#282a36",
            semanticDestructive: "#ff5555",
            semanticDestructiveForeground: "#f8f8f2",
            semanticSuccess: "#50fa7b",
            semanticSuccessForeground: "#282a36",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.3)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.5)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.7)",
        },
    },
    {
        name: "Solarized Light",
        styles: {
            // Surface colors - Solarized Light
            surfacePrimary: "#fdf6e3",
            surfaceSecondary: "#eee8d5",
            surfaceTertiary: "#e3dcc8",
            surfaceAccent: "#d9d0bb",
            surfaceMuted: "#eee8d5",

            // Content colors
            contentPrimary: "#657b83",
            contentSecondary: "#839496",
            contentTertiary: "#93a1a1",
            contentAccent: "#268bd2",

            // Border colors
            borderDefault: "#d9d0bb",
            borderAccent: "#268bd2",

            // Semantic colors - Solarized palette
            semanticPrimary: "#268bd2",
            semanticPrimaryForeground: "#fdf6e3",
            semanticDestructive: "#dc322f",
            semanticDestructiveForeground: "#fdf6e3",
            semanticSuccess: "#859900",
            semanticSuccessForeground: "#fdf6e3",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
        },
    },
    {
        name: "Solarized Dark",
        styles: {
            // Surface colors - Solarized Dark
            surfacePrimary: "#002b36",
            surfaceSecondary: "#073642",
            surfaceTertiary: "#0e4958",
            surfaceAccent: "#155d6d",
            surfaceMuted: "#073642",

            // Content colors
            contentPrimary: "#839496",
            contentSecondary: "#657b83",
            contentTertiary: "#586e75",
            contentAccent: "#268bd2",

            // Border colors
            borderDefault: "#155d6d",
            borderAccent: "#268bd2",

            // Semantic colors
            semanticPrimary: "#268bd2",
            semanticPrimaryForeground: "#fdf6e3",
            semanticDestructive: "#dc322f",
            semanticDestructiveForeground: "#fdf6e3",
            semanticSuccess: "#859900",
            semanticSuccessForeground: "#fdf6e3",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.2)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.4)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
        },
    },
    {
        name: "Monokai",
        styles: {
            // Surface colors - Monokai
            surfacePrimary: "#272822",
            surfaceSecondary: "#34352f",
            surfaceTertiary: "#3e3d32",
            surfaceAccent: "#49483e",
            surfaceMuted: "#34352f",

            // Content colors
            contentPrimary: "#f8f8f2",
            contentSecondary: "#cfcfc2",
            contentTertiary: "#75715e",
            contentAccent: "#66d9ef",

            // Border colors
            borderDefault: "#49483e",
            borderAccent: "#66d9ef",

            // Semantic colors - Monokai vibrant
            semanticPrimary: "#66d9ef",
            semanticPrimaryForeground: "#272822",
            semanticDestructive: "#f92672",
            semanticDestructiveForeground: "#f8f8f2",
            semanticSuccess: "#a6e22e",
            semanticSuccessForeground: "#272822",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.3)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.5)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.7)",
        },
    },
    {
        name: "Ocean",
        styles: {
            // Surface colors - Ocean inspired
            surfacePrimary: "#1a2332",
            surfaceSecondary: "#243447",
            surfaceTertiary: "#2e445c",
            surfaceAccent: "#385571",
            surfaceMuted: "#243447",

            // Content colors
            contentPrimary: "#e0e9f0",
            contentSecondary: "#b3c5d6",
            contentTertiary: "#7a92ab",
            contentAccent: "#4fd1c5",

            // Border colors
            borderDefault: "#385571",
            borderAccent: "#4fd1c5",

            // Semantic colors
            semanticPrimary: "#4fd1c5",
            semanticPrimaryForeground: "#1a2332",
            semanticDestructive: "#fc8181",
            semanticDestructiveForeground: "#ffffff",
            semanticSuccess: "#68d391",
            semanticSuccessForeground: "#1a2332",

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "0 1px 2px 0 rgba(0, 0, 0, 0.2)",
            shadowMd: "0 4px 6px -1px rgba(0, 0, 0, 0.4)",
            shadowLg: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
        },
    },
];

export function ThemeProvider({ children }: ThemeProviderProps) {
    // Default to first theme (Light) until we load from API
    const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
        const defaultTheme = themes[0]!;
        document.body.style.backgroundColor = defaultTheme.styles.surfacePrimary;
        // Apply default scrollbar theme colors
        document.documentElement.style.setProperty("--scrollbar-thumb", defaultTheme.styles.borderDefault);
        document.documentElement.style.setProperty("--scrollbar-track", "transparent");
        document.documentElement.style.setProperty("--scrollbar-thumb-hover", defaultTheme.styles.contentTertiary);
        return defaultTheme;
    });

    // Load theme from API on mount
    useEffect(() => {
        async function loadTheme() {
            try {
                const response = await fetch("/api/theme");
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data?.themeName) {
                        const savedTheme = themes.find(t => t.name === result.data.themeName);
                        if (savedTheme) {
                            setCurrentTheme(savedTheme);
                            document.body.style.backgroundColor = savedTheme.styles.surfacePrimary;
                            // Apply scrollbar theme colors
                            document.documentElement.style.setProperty("--scrollbar-thumb", savedTheme.styles.borderDefault);
                            document.documentElement.style.setProperty("--scrollbar-track", "transparent");
                            document.documentElement.style.setProperty("--scrollbar-thumb-hover", savedTheme.styles.contentTertiary);
                            // Notify native macOS app for title bar color sync
                            notifyNativeTheme(savedTheme.styles.surfaceSecondary, savedTheme.name);
                        }
                    } else {
                        // No saved theme, notify native app with default theme
                        notifyNativeTheme(themes[0]!.styles.surfaceSecondary, themes[0]!.name);
                    }
                } else {
                    // Failed to load, notify native app with default theme
                    notifyNativeTheme(themes[0]!.styles.surfaceSecondary, themes[0]!.name);
                }
            } catch (error) {
                console.error("Failed to load theme:", error);
                // On error, notify native app with default theme
                notifyNativeTheme(themes[0]!.styles.surfaceSecondary, themes[0]!.name);
            }
        }
        loadTheme();
    }, []);

    const setTheme = (theme: Theme) => {
        setCurrentTheme(theme);
        // Apply the background color to the document body
        document.body.style.backgroundColor = theme.styles.surfacePrimary;
        // Apply scrollbar theme colors
        document.documentElement.style.setProperty("--scrollbar-thumb", theme.styles.borderDefault);
        document.documentElement.style.setProperty("--scrollbar-track", "transparent");
        document.documentElement.style.setProperty("--scrollbar-thumb-hover", theme.styles.contentTertiary);
        // Notify native macOS app for title bar color sync
        notifyNativeTheme(theme.styles.surfaceSecondary, theme.name);
        // Persist theme selection to API
        fetch("/api/theme", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ themeName: theme.name }),
        }).catch(error => {
            console.error("Failed to save theme:", error);
        });
    };

    const value = {
        currentTheme,
        setTheme,
        themes,
    };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
