import type { AuthRequest, AuthResponse, CoreServiceBinding } from "@freshmarkets/contracts";
import { parseWebRuntimeConfiguration } from "../runtime/runtime-configuration";
import { readBoundedText } from "../http/bounded-body";
import { webRequestContext } from "../http/request-context";

export type AuthProxyCore = Pick<CoreServiceBinding, "auth">;
export const AUTH_REQUEST_MAX_BYTES = 256 * 1024;
export const AUTH_RESPONSE_MAX_BYTES = 1024 * 1024;

/**
 * Validates the environment-configured public application origin. The forwarded
 * auth origin must come from configuration, never from request-controlled
 * headers. HTTP is allowed only for explicit loopback development origins.
 */
export function resolvePublicAppOrigin(value: string | undefined): string {
  try {
    return parseWebRuntimeConfiguration({
      ENVIRONMENT: "development",
      PUBLIC_APP_ORIGIN: value,
    }).publicAppOrigin;
  } catch (error) {
    if (error instanceof Error && error.message === "PUBLIC_APP_ORIGIN_INSECURE")
      throw new Error("PUBLIC_APP_ORIGIN_INVALID");
    throw error;
  }
}

export async function proxyAuthRequest(
  request: Request,
  core: AuthProxyCore,
  publicAppOrigin: string,
): Promise<Response> {
  const context = webRequestContext(request);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const publicUrl = new URL(publicAppOrigin);
  headers["x-forwarded-host"] = publicUrl.host;
  headers["x-forwarded-proto"] = publicUrl.protocol.replace(":", "");
  headers["x-forwarded-origin"] = publicAppOrigin;
  headers["x-request-id"] = context.requestId;

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const bounded = await readBoundedText(request, {
      maxBytes: AUTH_REQUEST_MAX_BYTES,
      contentTypes: [
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
        "text/plain",
      ],
    });
    if (!bounded.ok) {
      return Response.json(
        { error: { ...bounded.error, requestId: context.requestId } },
        { status: bounded.error.status, headers: { "x-request-id": context.requestId } },
      );
    }
    body = bounded.value;
  }

  const input: AuthRequest = {
    method: request.method,
    url: request.url,
    headers,
    body,
  };
  const result: AuthResponse = await core.auth(input);
  if (new TextEncoder().encode(result.body).byteLength > AUTH_RESPONSE_MAX_BYTES) {
    return Response.json(
      {
        error: {
          code: "AUTH_RESPONSE_TOO_LARGE",
          message: "Authentication response was rejected",
          requestId: context.requestId,
        },
      },
      { status: 502, headers: { "x-request-id": context.requestId } },
    );
  }
  const responseHeaders = new Headers();
  for (const [key, value] of result.headers) responseHeaders.append(key, value);
  responseHeaders.set("x-request-id", context.requestId);
  return new Response(result.body || null, { status: result.status, headers: responseHeaders });
}
