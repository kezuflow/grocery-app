import { env } from "cloudflare:workers";
import { orderStates } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../../../operations-route-utils";

const bodySchema = z.object({
  status: z.enum(orderStates),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().nonnegative(),
});
async function POSTHandler(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return invalid(
      request,
      "A canonical Order status, audit reason and current version are required",
    );
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request);
  } catch {
    return invalid(request, "An idempotency-key header is required");
  }
  const { "order-id": orderId } = await context.params;
  return adminJson(
    await coreClient(env.CORE).overrideAdminOrderStatus({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      orderId,
      ...body.data,
      idempotencyKey,
    }),
  );
}
export const POST = observeAdminRoute("admin.orders.by_order_id.status.post", POSTHandler);
