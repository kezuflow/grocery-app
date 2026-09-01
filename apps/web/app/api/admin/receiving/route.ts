import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { optionalLimit, requiredLocation } from "../operations-route-utils";
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(request, params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(request, params);
  if (limit instanceof Response) return limit;
  return adminJson(
    await coreClient(env.CORE).listReceivingSessions({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
      cycleId: params.get("cycleId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}

export const GET = observeAdminRoute("admin.receiving.get", GETHandler);
