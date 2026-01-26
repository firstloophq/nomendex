export function getTodayDailyNoteFileName(date: Date = new Date()): string {
    const month = date.getMonth() + 1; // 1-12
    const day = date.getDate(); // 1-31
    const year = date.getFullYear();
    return `${month}-${day}-${year}.md`;
}

export function getYesterdayDailyNoteFileName(date: Date = new Date()): string {
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const month = yesterday.getMonth() + 1; // 1-12
    const day = yesterday.getDate(); // 1-31
    const year = yesterday.getFullYear();
    return `${month}-${day}-${year}.md`;
}

export function getTomorrowDailyNoteFileName(date: Date = new Date()): string {
    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const month = tomorrow.getMonth() + 1; // 1-12
    const day = tomorrow.getDate(); // 1-31
    const year = tomorrow.getFullYear();
    return `${month}-${day}-${year}.md`;
}

export function getDailyNoteFileName(date: Date): string {
    const month = date.getMonth() + 1; // 1-12
    const day = date.getDate(); // 1-31
    const year = date.getFullYear();
    return `${month}-${day}-${year}.md`;
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function fuzzyStartsWith(input: string, target: string): boolean {
    const inputLower = input.toLowerCase();
    const targetLower = target.toLowerCase();
    return targetLower.startsWith(inputLower) || inputLower.startsWith(targetLower);
}

function fuzzyMatch(input: string, ...targets: string[]): boolean {
    const inputLower = input.toLowerCase();
    return targets.some(target => fuzzyStartsWith(inputLower, target));
}

function findDayOfWeek(input: string): number | null {
    const inputLower = input.toLowerCase();
    for (let i = 0; i < DAY_NAMES.length; i++) {
        if (fuzzyStartsWith(inputLower, DAY_NAMES[i]) || fuzzyStartsWith(inputLower, DAY_ABBREVS[i])) {
            return i;
        }
    }
    return null;
}

function getNextDayOfWeek(dayIndex: number, fromDate: Date = new Date()): Date {
    const result = new Date(fromDate);
    const currentDay = result.getDay();
    let daysToAdd = dayIndex - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    return result;
}

function getLastDayOfWeek(dayIndex: number, fromDate: Date = new Date()): Date {
    const result = new Date(fromDate);
    const currentDay = result.getDay();
    let daysToSubtract = currentDay - dayIndex;
    if (daysToSubtract <= 0) daysToSubtract += 7;
    result.setDate(result.getDate() - daysToSubtract);
    return result;
}

/**
 * Converts a Date to a local date string (YYYY-MM-DD) without timezone conversion.
 * Use this for due dates to avoid UTC conversion issues.
 */
export function toLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD string as a local date (not UTC).
 * Use this instead of new Date("YYYY-MM-DD") which interprets the string as UTC.
 */
export function parseLocalDateString(dateString: string | Date): Date {
    // Handle when YAML parser returns a Date object directly
    if (dateString instanceof Date) {
        if (!isNaN(dateString.getTime())) {
            return dateString;
        }
        console.warn("[parseLocalDateString] Invalid Date object received, returning current date");
        return new Date();
    }

    if (!dateString) {
        console.warn("[parseLocalDateString] Empty date string, returning current date");
        return new Date();
    }

    // Handle ISO strings (e.g. 2023-01-01T10:00:00Z) by taking just the date part
    let normalizedString = dateString;
    if (dateString.includes("T")) {
        normalizedString = dateString.split("T")[0];
    }

    const parts = normalizedString.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        const [year, month, day] = parts;
        return new Date(year, month - 1, day);
    }

    // Fallback
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
        return date;
    }

    console.warn(`[parseLocalDateString] Invalid date string: "${dateString}", returning current date`);
    return new Date();
}

export function parseDateFromInput(input: string): Date | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    const today = new Date();
    const currentYear = today.getFullYear();

    // Simple keywords
    if (fuzzyMatch(lower, "today", "tod")) {
        return today;
    }
    if (fuzzyMatch(lower, "tomorrow", "tom")) {
        const result = new Date(today);
        result.setDate(result.getDate() + 1);
        return result;
    }
    if (fuzzyMatch(lower, "yesterday", "yest")) {
        const result = new Date(today);
        result.setDate(result.getDate() - 1);
        return result;
    }

    // "next <day>" or "ne <day>" patterns
    const nextMatch = lower.match(/^(ne(?:xt)?)\s+(.+)$/);
    if (nextMatch) {
        const dayPart = nextMatch[2];
        const dayIndex = findDayOfWeek(dayPart);
        if (dayIndex !== null) {
            return getNextDayOfWeek(dayIndex, today);
        }
        // "next week" - 7 days from now
        if (fuzzyMatch(dayPart, "week", "wee")) {
            const result = new Date(today);
            result.setDate(result.getDate() + 7);
            return result;
        }
    }

    // "last <day>" or "la <day>" patterns
    const lastMatch = lower.match(/^(la(?:st)?)\s+(.+)$/);
    if (lastMatch) {
        const dayPart = lastMatch[2];
        const dayIndex = findDayOfWeek(dayPart);
        if (dayIndex !== null) {
            return getLastDayOfWeek(dayIndex, today);
        }
        // "last week" - 7 days ago
        if (fuzzyMatch(dayPart, "week", "wee")) {
            const result = new Date(today);
            result.setDate(result.getDate() - 7);
            return result;
        }
    }

    // Just a day name - assume next occurrence
    const standaloneDayIndex = findDayOfWeek(lower);
    if (standaloneDayIndex !== null) {
        return getNextDayOfWeek(standaloneDayIndex, today);
    }

    // M-D-YYYY or M/D/YYYY (full year)
    const fullDateMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (fullDateMatch) {
        const [, month, day, year] = fullDateMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) return date;
    }

    // M-D or M/D (default to current year)
    const shortDateMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})$/);
    if (shortDateMatch) {
        const [, month, day] = shortDateMatch;
        const date = new Date(currentYear, parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) return date;
    }

    // YYYY-MM-DD (ISO format)
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) return date;
    }

    // Try natural Date.parse as fallback (handles "Jan 15, 2026" etc)
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) {
        return new Date(parsed);
    }

    return null;
}
