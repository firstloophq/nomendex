import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  SpanStatusCode,
  trace,
  type Attributes,
} from "@opentelemetry/api";
import { logs as otelLogs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";
const SERVICE_NAME = "team-backend";
const SERVICE_VERSION = "0.1.0";

let initialized = false;

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [keyRaw, valueRaw] = pair.split("=");
    const key = keyRaw?.trim();
    if (!key) continue;
    const value = valueRaw?.trim() ?? "";
    result[key] = value;
  }
  return result;
}

function isTelemetryEnabled(): boolean {
  const raw = process.env.OTEL_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  if (!isTelemetryEnabled()) {
    return;
  }

  if (process.env.OTEL_DIAGNOSTIC_LOGS === "1") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const endpoint = trimSlashes(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      || DEFAULT_OTLP_ENDPOINT,
  );
  const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    || `${endpoint}/v1/traces`;
  const logsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
    || `${endpoint}/v1/logs`;
  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || SERVICE_VERSION,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || "development",
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: tracesEndpoint,
          headers,
        }),
      ),
    ],
  });
  tracerProvider.register();

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: logsEndpoint,
          headers,
        }),
      ),
    ],
  });
  otelLogs.setGlobalLoggerProvider(loggerProvider);
}

export const appTracer = trace.getTracer("team-backend-tracer");

export async function withSpan<T>(params: {
  name: string;
  attributes?: Attributes;
  fn: () => Promise<T> | T;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    appTracer.startActiveSpan(params.name, { attributes: params.attributes }, async (span) => {
      try {
        const result = await params.fn();
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        resolve(result);
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.end();
        reject(error);
      }
    });
  });
}

export function addSpanEvent(name: string, attributes?: Attributes): void {
  const span = trace.getSpan(context.active());
  if (!span) return;
  span.addEvent(name, attributes);
}
