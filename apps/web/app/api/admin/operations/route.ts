import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Purpose-built admin operations board. Authorization, section filtering,
 * and allowed-action derivation happen in Core IAM; this route is transport
 * only.
 */
export async function GET(request: Request) {
  const locationId = new URL(request.url).searchParams.get("locationId");
  const result = await coreClient(env.CORE).adminOperationsBoard({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    locationId: locationId && locationId.trim() !== "" ? locationId : null,
  });
  return Response.json(result);
}
