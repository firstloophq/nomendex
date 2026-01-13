import { useEffect } from "react";

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check for updates silently in the background.
 * If an update is found, Swift will automatically show the Sparkle UI.
 */
export function checkForUpdatesInBackground() {
    if (window.webkit?.messageHandlers?.checkForUpdatesInBackground) {
        console.log("[UpdateNotification] Checking for updates in background...");
        window.webkit.messageHandlers.checkForUpdatesInBackground.postMessage({});
    }
}

/**
 * Trigger the native Sparkle update dialog.
 * Use this for manual "Check for Updates" button.
 */
export function triggerNativeUpdate() {
    if (window.webkit?.messageHandlers?.triggerAppUpdate) {
        console.log("[UpdateNotification] Triggering update check (with UI)...");
        window.webkit.messageHandlers.triggerAppUpdate.postMessage({});
    }
}

/**
 * Hook that manages automatic update checking.
 *
 * - Checks for updates silently on mount
 * - Polls every 15 minutes in the background
 * - Only shows Sparkle UI when an update is actually found
 *
 * Should be called once at the app root level.
 */
export function useUpdateNotification() {
    useEffect(() => {
        // Check for updates silently on mount
        checkForUpdatesInBackground();

        // Poll for updates every 15 minutes
        const intervalId = setInterval(() => {
            checkForUpdatesInBackground();
        }, UPDATE_CHECK_INTERVAL_MS);

        return () => {
            clearInterval(intervalId);
        };
    }, []);
}
