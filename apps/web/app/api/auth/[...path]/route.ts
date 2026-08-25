import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { proxyAuthRequest, resolvePublicAppOrigin } from "@/lib/auth/proxy";

async function proxy(request: Request): Promise<Response> {
  return proxyAuthRequest(
    request,
    env.CORE as unknown as CoreServiceBinding,
    resolvePublicAppOrigin(env.PUBLIC_APP_ORIGIN),
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
