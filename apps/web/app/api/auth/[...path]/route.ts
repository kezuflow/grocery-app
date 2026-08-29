import { env } from "cloudflare:workers";
import { proxyAuthRequest } from "@/lib/auth/proxy";
import { coreClient } from "@/lib/core-client/core";
import { parseWebRuntimeConfiguration } from "@/lib/runtime/runtime-configuration";

const runtime = parseWebRuntimeConfiguration(env);

async function proxy(request: Request): Promise<Response> {
  return proxyAuthRequest(request, coreClient(env.CORE), runtime.publicAppOrigin);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
