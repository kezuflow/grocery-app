import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const result = await (env.CORE as unknown as CoreServiceBinding).searchCatalog({
    requestId,
    query: url.searchParams.get("q") ?? undefined,
    locationId: url.searchParams.get("locationId") ?? undefined,
  });
  return Response.json(result, { headers: { "x-request-id": requestId } });
}
