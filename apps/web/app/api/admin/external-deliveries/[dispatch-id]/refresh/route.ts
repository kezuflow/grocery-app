import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../../../operations-route-utils";

const schema = z.object({
  locationId: z.string().trim().min(1),
  providerDeliveryId: z.string().trim().min(1).max(200).optional(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).optional(),
});

async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "dispatch-id": string }> },
) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid(request, "Location and current dispatch version are required");
  const { "dispatch-id": dispatchId } = await context.params;
  return adminJson(
    await coreClient(env.CORE).refreshExternalDelivery({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      dispatchId,
      ...parsed.data,
      idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
    }),
  );
}

export const POST = observeAdminRoute("admin.external_deliveries.refresh.post", POSTHandler);
