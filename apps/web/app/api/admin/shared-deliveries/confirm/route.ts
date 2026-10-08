import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../../operations-route-utils";

const bodySchema = z.object({
  locationId: z.string().trim().min(1).max(200),
  bookingId: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  combinedLoadFits: z.literal(true),
});
async function POSTHandler(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "Confirm the reviewed booking and combined load");
  let key: string;
  try {
    key = requireIdempotencyKey(request);
  } catch {
    return invalid(request, "An idempotency key is required");
  }
  return adminJson(
    await coreClient(env.CORE).confirmSharedDelivery({
      ...parsed.data,
      idempotencyKey: key,
      requestId: webRequestId(request),
      headers: requestHeaders(request),
    }),
  );
}
export const POST = observeAdminRoute("admin.shared_deliveries.confirm", POSTHandler);
