const CRDT_DEBUG_STORAGE_KEY = "nomendex:crdt-debug";
const MAX_STRING_LENGTH = 180;
const MAX_ARRAY_LENGTH = 40;
const MAX_OBJECT_KEYS = 24;
const MAX_DEPTH = 3;

type DebugLevel = "info" | "warn" | "error" | "debug";

let sessionId: string | null = null;
let sessionTraceId: string | null = null;
let sequence = 0;

function getSessionId(): string {
    if (sessionId) return sessionId;
    sessionId = `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return sessionId;
}

function randomHex(bytes: number): string {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        const view = new Uint8Array(bytes);
        crypto.getRandomValues(view);
        return Array.from(view)
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
    }
    let fallback = "";
    for (let i = 0; i < bytes; i++) {
        fallback += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    }
    return fallback;
}

function getTraceId(): string {
    if (sessionTraceId) return sessionTraceId;
    sessionTraceId = randomHex(16);
    return sessionTraceId;
}

function createSpanId(): string {
    return randomHex(8);
}

export function isCRDTDebugEnabled(): boolean {
    if (typeof window === "undefined") return true;

    try {
        const value = window.localStorage.getItem(CRDT_DEBUG_STORAGE_KEY);
        if (!value) return true;
        const normalized = value.trim().toLowerCase();
        return normalized !== "0" && normalized !== "false" && normalized !== "off";
    } catch {
        return true;
    }
}

function sanitize(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return "[max-depth]";

    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
        if (value.length <= MAX_STRING_LENGTH) return value;
        return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated:${value.length}]`;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;

    if (Array.isArray(value)) {
        const trimmed = value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitize(item, depth + 1));
        if (value.length > MAX_ARRAY_LENGTH) {
            trimmed.push(`[+${value.length - MAX_ARRAY_LENGTH} more]`);
        }
        return trimmed;
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        const keys = Object.keys(obj).slice(0, MAX_OBJECT_KEYS);
        for (const key of keys) {
            out[key] = sanitize(obj[key], depth + 1);
        }
        if (Object.keys(obj).length > MAX_OBJECT_KEYS) {
            out.__truncatedKeys = Object.keys(obj).length - MAX_OBJECT_KEYS;
        }
        return out;
    }

    return String(value);
}

type MaybeOp = {
    type?: unknown;
    id?: { clientId?: unknown; clock?: unknown };
    targetId?: { clientId?: unknown; clock?: unknown };
    targetIds?: ReadonlyArray<unknown>;
    attr?: unknown;
    action?: unknown;
    side?: unknown;
    content?: { type?: unknown; blockType?: unknown; nodeType?: unknown };
};

export function summarizeOpsForDebug(ops: ReadonlyArray<MaybeOp>): ReadonlyArray<Record<string, unknown>> {
    return ops.slice(0, 30).map((op) => ({
        type: op.type,
        id: op.id ? `${String(op.id.clientId)}:${String(op.id.clock)}` : null,
        targetId: op.targetId ? `${String(op.targetId.clientId)}:${String(op.targetId.clock)}` : null,
        targetIdsCount: Array.isArray(op.targetIds) ? op.targetIds.length : null,
        action: op.action ?? null,
        attr: op.attr ?? null,
        side: op.side ?? null,
        contentType: op.content?.type ?? null,
        blockType: op.content?.blockType ?? null,
        nodeType: op.content?.nodeType ?? null,
    }));
}

export function crdtDebugLog(params: {
    event: string;
    data?: unknown;
    level?: DebugLevel;
}): void {
    if (!isCRDTDebugEnabled()) return;
    if (typeof window === "undefined" || typeof fetch === "undefined") return;

    const traceId = getTraceId();
    const spanId = createSpanId();
    sequence += 1;

    const payload = {
        event: `CRDT:${params.event}`,
        level: params.level ?? "debug",
        context: "crdt",
        traceId,
        spanId,
        data: sanitize({
            ...((params.data as Record<string, unknown>) ?? {}),
            sessionId: getSessionId(),
            href: window.location.href,
            ts: Date.now(),
            sequence,
            traceId,
            spanId,
        }),
    };

    void fetch("/api/logs", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        keepalive: true,
        body: JSON.stringify(payload),
    }).catch(() => {
        // Best-effort debug logging.
    });
}

export { CRDT_DEBUG_STORAGE_KEY };
