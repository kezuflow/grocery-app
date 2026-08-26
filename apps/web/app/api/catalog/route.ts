import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const result = await coreClient(env.CORE).searchCatalog({
    requestId,
    query: url.searchParams.get("q") ?? undefined,
    locationId: url.searchParams.get("locationId") ?? undefined,
  });
  return Response.json(result, { headers: { "x-request-id": requestId } });
}
