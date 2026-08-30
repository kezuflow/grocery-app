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
