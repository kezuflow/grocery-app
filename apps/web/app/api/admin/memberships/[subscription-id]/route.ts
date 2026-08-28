import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one membership. */
export async function GET(
  request: Request,
  context: { params: Promise<{ "subscription-id": string }> },
) {
  const { "subscription-id": subscriptionId } = await context.params;
  const result = await coreClient(env.CORE).getAdminMembership({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    subscriptionId,
  });
  return Response.json(result);
}
