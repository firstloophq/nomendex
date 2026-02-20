import { createServiceLogger } from "@/lib/logger";

const otelLogger = createServiceLogger("OTEL");

const DEFAULT_OTEL_BASE_URL = "http://localhost:4318";
const DEFAULT_SERVICE_NAME = "nomendex-sidecar";
const DEFAULT_SCOPE_NAME = "nomendex.sidecar.logs";
const DEFAULT_SCOPE_VERSION = "1.0.0";

const MAX_QUEUE_SIZE = 5000;
const MAX_BATCH_SIZE = 200;
const FLUSH_DELAY_MS = 750;
const FAILURE_BACKOFF_MS = 30000;

const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 30;

const PROMOTED_DATA_KEYS = [
    "sessionId",
    "canvasId",
    "docId",
    "clientId",
    "remoteClientId",
    "attemptId",
    "transport",
    "reason",
    "count",
    "updatedAt",
    "bytes",
    "durationMs",
    "message",
] as const;

type TelemetryLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

interface TelemetryLogEvent {
    event: string;
    level?: string;
    context?: string;
    message?: string;
    data?: unknown;
    traceId?: string | null;
    spanId?: string | null;
    serviceName?: string;
    source?: string;
    timestampMs?: number;
}

interface NormalizedTelemetryLogEvent {
    event: string;
    level: TelemetryLevel;
    context: string;
    message: string;
    data: unknown;
    traceId: string | null;
    spanId: string | null;
    serviceName: string;
    source: string;
    timestampMs: number;
}

interface OtlpAnyValue {
    stringValue?: string;
    boolValue?: boolean;
    intValue?: string;
    doubleValue?: number;
    arrayValue?: {
        values: OtlpAnyValue[];
    };
    kvlistValue?: {
        values: Array<{
            key: string;
            value: OtlpAnyValue;
        }>;
    };
}

interface OtlpLogRecord {
    timeUnixNano: string;
    severityNumber: number;
    severityText: string;
    body: OtlpAnyValue;
    attributes: Array<{
        key: string;
        value: OtlpAnyValue;
    }>;
    traceId?: string;
    spanId?: string;
}

interface OtlpPayload {
    resourceLogs: Array<{
        resource: {
            attributes: Array<{
                key: string;
                value: OtlpAnyValue;
            }>;
        };
        scopeLogs: Array<{
            scope: {
                name: string;
                version: string;
            };
            logRecords: OtlpLogRecord[];
        }>;
    }>;
}

function isEnabledFlag(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveLogsEndpoint(): string | null {
    const explicit = process.env.NOMENDEX_OTEL_LOGS_ENDPOINT?.trim()
        || process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
    if (explicit) {
        try {
            return new URL(explicit).toString();
        } catch {
            otelLogger.warn("Invalid NOMENDEX_OTEL_LOGS_ENDPOINT/OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", { explicit });
            return null;
        }
    }

    const base = process.env.NOMENDEX_OTEL_EXPORTER_ENDPOINT?.trim()
        || process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
        || DEFAULT_OTEL_BASE_URL;

    try {
        const parsed = new URL(base);
        if (parsed.pathname === "/" || parsed.pathname === "") {
            parsed.pathname = "/v1/logs";
        }
        return parsed.toString();
    } catch {
        otelLogger.warn("Invalid NOMENDEX_OTEL_EXPORTER_ENDPOINT/OTEL_EXPORTER_OTLP_ENDPOINT", { base });
        return null;
    }
}

function toUnixNano(timestampMs: number): string {
    const safeMs = Number.isFinite(timestampMs) ? Math.max(0, Math.floor(timestampMs)) : Date.now();
    return `${BigInt(safeMs) * 1000000n}`;
}

function normalizeLevel(level: string | undefined): TelemetryLevel {
    const normalized = level?.trim().toLowerCase();
    if (
        normalized === "trace"
        || normalized === "debug"
        || normalized === "info"
        || normalized === "warn"
        || normalized === "error"
        || normalized === "fatal"
    ) {
        return normalized;
    }
    if (normalized === "warning") return "warn";
    return "info";
}

function severityFromLevel(level: TelemetryLevel): {
    severityNumber: number;
    severityText: string;
} {
    switch (level) {
        case "trace":
            return { severityNumber: 1, severityText: "TRACE" };
        case "debug":
            return { severityNumber: 5, severityText: "DEBUG" };
        case "info":
            return { severityNumber: 9, severityText: "INFO" };
        case "warn":
            return { severityNumber: 13, severityText: "WARN" };
        case "error":
            return { severityNumber: 17, severityText: "ERROR" };
        case "fatal":
            return { severityNumber: 21, severityText: "FATAL" };
        default:
            return { severityNumber: 9, severityText: "INFO" };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeHexId(value: string | null | undefined, expectedLength: 16 | 8): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase().replace(/^0x/, "");
    const pattern = expectedLength === 16 ? /^[0-9a-f]{32}$/ : /^[0-9a-f]{16}$/;
    if (!pattern.test(normalized)) return null;
    return normalized;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return "[max-depth]";

    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
        if (value.length <= MAX_STRING_LENGTH) return value;
        return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated:${value.length}]`;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;

    if (Array.isArray(value)) {
        const limited = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
        if (value.length > MAX_ARRAY_ITEMS) {
            limited.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
        }
        return limited;
    }

    if (typeof value === "object") {
        const input = value as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        const keys = Object.keys(input).slice(0, MAX_OBJECT_KEYS);
        for (const key of keys) {
            output[key] = sanitizeValue(input[key], depth + 1);
        }
        if (Object.keys(input).length > MAX_OBJECT_KEYS) {
            output.__truncatedKeys = Object.keys(input).length - MAX_OBJECT_KEYS;
        }
        return output;
    }

    return String(value);
}

function toAnyValue(value: unknown): OtlpAnyValue {
    if (value === null || value === undefined) {
        return { stringValue: "null" };
    }

    if (typeof value === "string") {
        return { stringValue: value };
    }

    if (typeof value === "boolean") {
        return { boolValue: value };
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return { stringValue: String(value) };
        }
        if (Number.isInteger(value)) {
            return { intValue: String(value) };
        }
        return { doubleValue: value };
    }

    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map((item) => toAnyValue(item)),
            },
        };
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return {
            kvlistValue: {
                values: Object.entries(obj).map(([key, child]) => ({
                    key,
                    value: toAnyValue(child),
                })),
            },
        };
    }

    return { stringValue: String(value) };
}

function buildAttribute(key: string, value: unknown): {
    key: string;
    value: OtlpAnyValue;
} | null {
    if (value === undefined) return null;
    return {
        key,
        value: toAnyValue(sanitizeValue(value)),
    };
}

function normalizeEvent(input: TelemetryLogEvent): NormalizedTelemetryLogEvent {
    const level = normalizeLevel(input.level);
    const data = sanitizeValue(input.data);
    const traceId = normalizeHexId(input.traceId, 16);
    const spanId = normalizeHexId(input.spanId, 8);
    const fallbackMessage = input.message?.trim() || input.event || "nomendex.log";
    return {
        event: input.event,
        level,
        context: input.context?.trim() || "app",
        message: fallbackMessage,
        data,
        traceId,
        spanId,
        serviceName: input.serviceName?.trim() || process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
        source: input.source?.trim() || "server",
        timestampMs: input.timestampMs ?? Date.now(),
    };
}

function attributesFromEvent(event: NormalizedTelemetryLogEvent): Array<{
    key: string;
    value: OtlpAnyValue;
}> {
    const attributes: Array<{ key: string; value: OtlpAnyValue }> = [];
    const base = [
        buildAttribute("nomendex.event", event.event),
        buildAttribute("nomendex.context", event.context),
        buildAttribute("nomendex.source", event.source),
    ];
    for (const candidate of base) {
        if (candidate) attributes.push(candidate);
    }

    if (isRecord(event.data)) {
        for (const key of PROMOTED_DATA_KEYS) {
            const value = event.data[key];
            if (value === undefined) continue;
            const promoted = buildAttribute(`nomendex.${key}`, value);
            if (promoted) attributes.push(promoted);
        }
    }

    const payload = buildAttribute("nomendex.data", event.data);
    if (payload) attributes.push(payload);

    return attributes;
}

function buildPayload(events: ReadonlyArray<NormalizedTelemetryLogEvent>): OtlpPayload {
    const groupedByService = new Map<string, NormalizedTelemetryLogEvent[]>();
    for (const event of events) {
        const group = groupedByService.get(event.serviceName);
        if (group) {
            group.push(event);
        } else {
            groupedByService.set(event.serviceName, [event]);
        }
    }

    return {
        resourceLogs: Array.from(groupedByService.entries()).map(([serviceName, grouped]) => ({
            resource: {
                attributes: [
                    buildAttribute("service.name", serviceName),
                    buildAttribute("service.namespace", "nomendex"),
                    buildAttribute("deployment.environment", process.env.NODE_ENV || "development"),
                ].filter((value): value is { key: string; value: OtlpAnyValue } => value !== null),
            },
            scopeLogs: [
                {
                    scope: {
                        name: DEFAULT_SCOPE_NAME,
                        version: DEFAULT_SCOPE_VERSION,
                    },
                    logRecords: grouped.map((event): OtlpLogRecord => {
                        const severity = severityFromLevel(event.level);
                        const record: OtlpLogRecord = {
                            timeUnixNano: toUnixNano(event.timestampMs),
                            severityNumber: severity.severityNumber,
                            severityText: severity.severityText,
                            body: {
                                stringValue: event.message,
                            },
                            attributes: attributesFromEvent(event),
                        };
                        if (event.traceId) {
                            record.traceId = event.traceId;
                        }
                        if (event.spanId) {
                            record.spanId = event.spanId;
                        }
                        return record;
                    }),
                },
            ],
        })),
    };
}

const otelLogsEnabled = isEnabledFlag(process.env.NOMENDEX_OTEL_LOGS_ENABLED ?? "0");
const otelLogsEndpoint = resolveLogsEndpoint();

let queue: NormalizedTelemetryLogEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;
let consecutiveFailures = 0;
let backoffUntilMs = 0;

function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushLogs();
    }, FLUSH_DELAY_MS);
}

function enqueue(event: NormalizedTelemetryLogEvent): void {
    queue.push(event);
    if (queue.length > MAX_QUEUE_SIZE) {
        queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
    }
}

async function flushLogs(): Promise<void> {
    if (!otelLogsEnabled || !otelLogsEndpoint) return;
    if (isFlushing) return;
    if (queue.length === 0) return;

    const now = Date.now();
    if (backoffUntilMs > now) {
        scheduleFlush();
        return;
    }

    isFlushing = true;
    const batch = queue.slice(0, MAX_BATCH_SIZE);
    queue = queue.slice(batch.length);

    try {
        const payload = buildPayload(batch);
        const response = await fetch(otelLogsEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`status=${response.status}`);
        }
        consecutiveFailures = 0;
    } catch (error) {
        queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
            backoffUntilMs = Date.now() + FAILURE_BACKOFF_MS;
        }
        otelLogger.warn("Failed to export logs to OTEL viewer", {
            endpoint: otelLogsEndpoint,
            consecutiveFailures,
            backoffUntilMs,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        isFlushing = false;
        if (queue.length > 0) {
            scheduleFlush();
            if (queue.length >= MAX_BATCH_SIZE) {
                void flushLogs();
            }
        }
    }
}

export function emitOTelLog(event: TelemetryLogEvent): void {
    if (!otelLogsEnabled || !otelLogsEndpoint) return;
    const normalized = normalizeEvent(event);
    enqueue(normalized);
    if (queue.length >= MAX_BATCH_SIZE) {
        void flushLogs();
        return;
    }
    scheduleFlush();
}

export function getOTelLogsConfig(): {
    enabled: boolean;
    endpoint: string | null;
} {
    return {
        enabled: otelLogsEnabled && !!otelLogsEndpoint,
        endpoint: otelLogsEndpoint,
    };
}
