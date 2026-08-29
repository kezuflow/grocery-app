import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for the Core-owned payment overview. */
export async function GET(request: Request) {
  const result = await coreClient(env.CORE).getAdminPaymentOverview({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json(result);
}
