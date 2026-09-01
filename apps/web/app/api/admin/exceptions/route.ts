import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid, optionalLimit, requiredLocation } from "../operations-route-utils";
const schema = z.object({
  locationId: z.string().trim().min(1),
  kind: z.enum(["FULFILLMENT_SHORTAGE", "DELIVERY_FAILED"]),
  action: z.enum(["RETRY_FULFILLMENT", "RETRY_DELIVERY"]),
  orderId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1).optional(),
});
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(request, params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(request, params);
  if (limit instanceof Response) return limit;
  return adminJson(
    await coreClient(env.CORE).listOperationalExceptions({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}
async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid(request, "exception, reason, and current expectedVersion are required");
  try {
    const meta = commandMeta(request, parsed.data);
    return adminJson(
      await coreClient(env.CORE).resolveAdminOperationalException({
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        ...parsed.data,
        ...meta,
      }),
    );
  } catch (error) {
    return invalid(request, (error as Error).message);
  }
}

export const GET = observeAdminRoute("admin.exceptions.get", GETHandler);

export const POST = observeAdminRoute("admin.exceptions.post", POSTHandler);
