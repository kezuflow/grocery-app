import { webRequestContext } from "./request-context";

type AdminRouteHandler<Arguments extends unknown[]> = (
  request: Request,
  ...args: Arguments
) => Response | Promise<Response>;

type SafeWebLogContext = Readonly<Record<string, boolean | number | string>>;

function durationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function logAdminRoute(level: "info" | "error", context: SafeWebLogContext): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: "admin.web.request",
    ...context,
  });
  if (level === "error") console.error(payload);
  else console.log(payload);
}

function withCorrelation<RequestType extends Request>(
  request: RequestType,
  requestId: string,
): RequestType {
  request.headers.set("x-request-id", requestId);
  return request;
}

function withTiming(
  response: Response,
  requestId: string,
  startedAt: number,
): { response: Response; durationMs: number } {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  const observed = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const totalDurationMs = durationMs(startedAt);
  observed.headers.append("server-timing", `web;dur=${totalDurationMs};desc="Admin Web adapter"`);
  return { response: observed, durationMs: totalDurationMs };
}

/**
 * Adds one bounded request ID and safe transport timing to an Admin Web adapter.
 * The wrapper deliberately records no URL, query, headers, body, actor, or error message.
 */
export function observeAdminRoute<Arguments extends unknown[]>(
  operation: string,
  handler: AdminRouteHandler<Arguments>,
): AdminRouteHandler<Arguments> {
  return async (request, ...args) => {
    const startedAt = performance.now();
    const context = webRequestContext(request);
    try {
      const response = await handler(withCorrelation(request, context.requestId), ...args);
      const observed = withTiming(response, context.requestId, startedAt);
      logAdminRoute("info", {
        requestId: context.requestId,
        operation,
        method: request.method,
        status: response.status,
        durationMs: observed.durationMs,
        result: response.ok ? "success" : "error",
      });
      return observed.response;
    } catch (error) {
      logAdminRoute("error", {
        requestId: context.requestId,
        operation,
        method: request.method,
        durationMs: durationMs(startedAt),
        result: "exception",
      });
      throw error;
    }
  };
}

/** Measures only synchronous JSON serialization and response construction. */
export function adminJson(body: unknown, init?: ResponseInit): Response {
  const startedAt = performance.now();
  const response = Response.json(body, init);
  response.headers.append(
    "server-timing",
    `serialize;dur=${durationMs(startedAt)};desc="Web JSON serialization"`,
  );
  return response;
}
