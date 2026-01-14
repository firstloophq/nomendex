/**
 * Environment variable configuration
 *
 * This module provides typed access to environment variables used throughout the application.
 */

/**
 * Check if warnings (alpha dialog and Git/GitHub setup prompts) should be suppressed.
 * Controlled by NOETECT_SUPPRESS_WARNINGS environment variable.
 *
 * @returns true if warnings should be suppressed, false otherwise (default)
 */
export function shouldSuppressWarnings(): boolean {
    const value = process.env.NOETECT_SUPPRESS_WARNINGS;
    return value === "true" || value === "1";
}
