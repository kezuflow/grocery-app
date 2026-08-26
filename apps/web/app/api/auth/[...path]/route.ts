import { env } from "cloudflare:workers";
import { proxyAuthRequest, resolvePublicAppOrigin } from "@/lib/auth/proxy";
import { coreClient } from "@/lib/core-client/core";

async function proxy(request: Request): Promise<Response> {
  return proxyAuthRequest(
    request,
    coreClient(env.CORE),
    resolvePublicAppOrigin(env.PUBLIC_APP_ORIGIN),
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
