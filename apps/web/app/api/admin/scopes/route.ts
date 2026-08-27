import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Thin same-origin BFF adapter for permitted admin scope options. Scope
 * resolution happens in Core; this route is transport only.
 */
export async function GET(request: Request) {
  const result = await coreClient(env.CORE).listAdminScopes({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json(result);
}
