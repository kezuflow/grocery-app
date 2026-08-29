import type { AuthRequest, AuthResponse, CoreServiceBinding } from "@freshmarkets/contracts";
import { parseWebRuntimeConfiguration } from "../runtime/runtime-configuration";

export type AuthProxyCore = Pick<CoreServiceBinding, "auth">;

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
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const publicUrl = new URL(publicAppOrigin);
  headers["x-forwarded-host"] = publicUrl.host;
  headers["x-forwarded-proto"] = publicUrl.protocol.replace(":", "");
  headers["x-forwarded-origin"] = publicAppOrigin;

  const input: AuthRequest = {
    method: request.method,
    url: request.url,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
  };
  const result: AuthResponse = await core.auth(input);
  const responseHeaders = new Headers();
  for (const [key, value] of result.headers) responseHeaders.append(key, value);
  return new Response(result.body || null, { status: result.status, headers: responseHeaders });
}
