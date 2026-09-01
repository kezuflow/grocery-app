import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  dispatchContextSchema,
  orderedDeliveriesSchema,
  validationFailure,
} from "../delivery-map-route-utils";

const bodySchema = z.union([
  dispatchContextSchema.options[0].extend({ orderedDeliveries: orderedDeliveriesSchema }).strict(),
  dispatchContextSchema.options[1].extend({ orderedDeliveries: orderedDeliveriesSchema }).strict(),
]);

async function POSTHandler(request: Request) {
  const requestId = webRequestId(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationFailure(requestId, "Invalid route preview request");

  return adminJson(
    await coreClient(env.CORE).previewDeliveryBatchRoute({
      requestId,
      headers: requestHeaders(request),
      ...parsed.data,
    }),
  );
}

export const POST = observeAdminRoute("admin.delivery_map.route_preview.post", POSTHandler);
