import { env } from "cloudflare:workers";
import type { AuthRequest, AuthResponse, CoreServiceBinding } from "@freshmarkets/contracts";

async function proxy(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const host = request.headers.get("host");
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  if (host) headers["x-forwarded-host"] = host;
  headers["x-forwarded-proto"] = new URL(request.url).protocol.replace(":", "");
  headers["x-forwarded-origin"] = origin;

  const input: AuthRequest = {
    method: request.method,
    url: request.url,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
  };
  const result: AuthResponse = await (env.CORE as unknown as CoreServiceBinding).auth(input);
  const responseHeaders = new Headers();
  for (const [key, value] of result.headers) responseHeaders.append(key, value);
  return new Response(result.body || null, { status: result.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
