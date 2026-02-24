import { context, trace } from "@opentelemetry/api";
import { logs as otelLogs, SeverityNumber } from "@opentelemetry/api-logs";
import winston from "winston";
import { addSpanEvent } from "./telemetry";

type LogLevel = "error" | "warn" | "info" | "debug";

const service = process.env.OTEL_SERVICE_NAME || "team-backend";
const loggerName = "team-backend-logger";
const otelLogger = otelLogs.getLogger(loggerName);

function getTraceContext() {
  const span = trace.getSpan(context.active());
  if (!span) return { traceId: undefined, spanId: undefined };
  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

function severityForLevel(level: LogLevel): SeverityNumber {
  switch (level) {
    case "error":
      return SeverityNumber.ERROR;
    case "warn":
      return SeverityNumber.WARN;
    case "debug":
      return SeverityNumber.DEBUG;
    case "info":
    default:
      return SeverityNumber.INFO;
  }
}

export const appLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: {
    service,
    env: process.env.NODE_ENV || "development",
  },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

export function logEvent(params: {
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}): void {
  const traceCtx = getTraceContext();
  appLogger.log({
    level: params.level,
    message: params.event,
    ...traceCtx,
    ...(params.data ?? {}),
  });

  const attrs = {
    "log.event": params.event,
    ...(traceCtx.traceId ? { "log.trace_id": traceCtx.traceId } : {}),
    ...(traceCtx.spanId ? { "log.span_id": traceCtx.spanId } : {}),
    ...Object.fromEntries(
      Object.entries(params.data ?? {}).map(([k, v]) => [
        k,
        typeof v === "string"
          ? v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v),
      ]),
    ),
  };
  otelLogger.emit({
    severityNumber: severityForLevel(params.level),
    severityText: params.level.toUpperCase(),
    body: params.event,
    attributes: attrs,
  });
  addSpanEvent(params.event, attrs);
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  logEvent({ level: "info", event, data });
}

export function logWarn(event: string, data?: Record<string, unknown>): void {
  logEvent({ level: "warn", event, data });
}

export function logError(event: string, data?: Record<string, unknown>): void {
  logEvent({ level: "error", event, data });
}
