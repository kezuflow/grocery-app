import { env } from "cloudflare:workers";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requiredLocation } from "../operations-route-utils";

async function GETHandler(request: Request) {
  const locationId = requiredLocation(request, new URL(request.url).searchParams);
  if (locationId instanceof Response) return locationId;
  return adminJson(
    await coreClient(env.CORE).listOperationalActivity({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
    }),
  );
}

export const GET = observeAdminRoute("admin.operations_activity.get", GETHandler);
