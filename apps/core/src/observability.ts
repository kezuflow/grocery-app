export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Readonly<Record<string, boolean | number | string | undefined>>;

export function log(level: LogLevel, event: string, context: LogContext = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  };

  if (level === "error") console.error(JSON.stringify(payload));
  else if (level === "warn") console.warn(JSON.stringify(payload));
  else if (level === "debug") console.debug(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

export function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}
