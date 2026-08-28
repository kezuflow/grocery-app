import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { optionalLimit, requiredLocation } from "../operations-route-utils";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(params);
  if (limit instanceof Response) return limit;
  return Response.json(
    await coreClient(env.CORE).listReceivingSessions({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      locationId,
      cycleId: params.get("cycleId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}
