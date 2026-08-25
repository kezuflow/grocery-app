import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { requestHeaders } from "../../../../lib/core-client/request";
export async function GET(request: Request) {
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).listCustomerOrders({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}
