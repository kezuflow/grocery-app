import { tracing } from "cloudflare:workers";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Readonly<Record<string, boolean | number | string | undefined>>;

const SENSITIVE_LOG_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "token",
  "accesstoken",
  "refreshtoken",
  "clienttoken",
  "secret",
  "password",
  "rawbody",
  "webhookbody",
  "providerpayload",
  "payload",
  "actionurl",
  "resetlink",
  "addresssnapshot",
  "addresssnapshotjson",
]);
const SAFE_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function safeLogContext(
  context: LogContext,
): Record<string, boolean | number | string | undefined> {
  const safe: Record<string, boolean | number | string | undefined> = {};
  for (const [key, value] of Object.entries(context)) {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
    safe[key] = SENSITIVE_LOG_KEYS.has(normalized) ? "[REDACTED]" : value;
  }
  return safe;
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

export function log(level: LogLevel, event: string, context: LogContext = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeLogContext(context),
  };

  if (level === "error") console.error(JSON.stringify(payload));
  else if (level === "warn") console.warn(JSON.stringify(payload));
  else if (level === "debug") console.debug(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

export function requestId(request: Request): string {
  const inbound = request.headers.get("x-request-id");
  return inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
}

export async function traceOperation<T>(
  name: string,
  context: LogContext,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return tracing.enterSpan(name, async (span) => {
    span.setAttributes(safeLogContext(context));
    const startedAt = performance.now();
    try {
      const result = await operation(span);
      span.setAttribute("result", "success");
      return result;
    } catch (error) {
      span.setAttribute("result", "exception");
      throw error;
    } finally {
      span.setAttribute("duration.ms", elapsedMs(startedAt));
    }
  });
}

type RpcOutcome = {
  ok?: unknown;
  error?: { code?: unknown };
};

export async function observeCoreRpc<T>(
  operationName: string,
  correlationId: string,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await traceOperation(
      `rpc.${operationName}`,
      { requestId: correlationId, operation: operationName },
      operation,
    );
    const outcome = result as RpcOutcome;
    const succeeded = outcome?.ok !== false;
    const errorCode =
      !succeeded && typeof outcome.error?.code === "string" ? outcome.error.code : undefined;
    log(succeeded ? "info" : "warn", "core.rpc.completed", {
      requestId: correlationId,
      operation: operationName,
      durationMs: elapsedMs(startedAt),
      result: succeeded ? "success" : "error",
      errorCode,
    });
    return result;
  } catch (error) {
    log("error", "core.rpc.completed", {
      requestId: correlationId,
      operation: operationName,
      durationMs: elapsedMs(startedAt),
      result: "exception",
    });
    throw error;
  }
}

export function setD1SpanAttributes(span: Span, meta: D1Meta): void {
  span.setAttributes({
    "db.duration.ms": meta.duration,
    "db.sql.duration.ms": meta.timings?.sql_duration_ms,
    "db.rows.read": meta.rows_read,
    "db.rows.written": meta.rows_written,
    "db.attempts": meta.total_attempts,
  });
}
