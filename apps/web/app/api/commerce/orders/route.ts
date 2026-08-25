import { env } from "cloudflare:workers";
import { requestHeaders } from "../../../../lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
export async function GET(request: Request) {
  return Response.json(
    await coreClient(env.CORE).listCustomerOrders({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}
