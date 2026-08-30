import { requestHeaders } from "../core-client/request";
import type { BoundedBodyError } from "./bounded-body";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type WebRequestContext = {
  requestId: string;
  coreHeaders: Record<string, string>;
};

export function webRequestContext(request: Request): WebRequestContext {
  const inbound = request.headers.get("x-request-id");
  const requestId = inbound && UUID_PATTERN.test(inbound) ? inbound : crypto.randomUUID();
  return {
    requestId,
    coreHeaders: { ...requestHeaders(request), "x-request-id": requestId },
  };
}

export function jsonWithRequestId(
  body: unknown,
  requestId: string,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId);
  return Response.json(body, { ...init, headers });
}

export function boundedBodyErrorResponse(error: BoundedBodyError, requestId: string): Response {
  return jsonWithRequestId(
    { ok: false, error: { code: error.code, message: error.message, requestId } },
    requestId,
    { status: error.status },
  );
}
