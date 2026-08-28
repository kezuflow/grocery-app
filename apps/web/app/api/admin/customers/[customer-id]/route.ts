import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one composed customer detail. */
export async function GET(
  request: Request,
  context: { params: Promise<{ "customer-id": string }> },
) {
  const { "customer-id": customerId } = await context.params;
  const result = await coreClient(env.CORE).getAdminCustomer({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    customerId,
  });
  return Response.json(result);
}
