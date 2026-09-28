import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { invalid, requiredLocation } from "../operations-route-utils";

async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(request, params);
  if (locationId instanceof Response) return locationId;
  const orderId = params.get("orderId")?.trim();
  if (!orderId) return invalid(request, "orderId is required");
  return adminJson(
    await coreClient(env.CORE).getAdminDeliveryTracking({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
      orderId,
    }),
  );
}

export const GET = observeAdminRoute("admin.delivery.tracking", GETHandler);
