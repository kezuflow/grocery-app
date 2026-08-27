import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Thin same-origin BFF adapter for the admin context. Authorization and
 * navigation derivation happen in Core IAM; this route is transport only.
 */
export async function GET(request: Request) {
  const result = await coreClient(env.CORE).getAdminContext({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json(result);
}
