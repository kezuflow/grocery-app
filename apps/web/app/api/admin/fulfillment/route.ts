import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid, optionalLimit, requiredLocation } from "../operations-route-utils";

const commandSchema = z.object({
  locationId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  action: z.enum([
    "START_PICKING",
    "MARK_READY_TO_PACK",
    "START_PACKING",
    "MARK_PACKED",
    "HAND_OFF",
    "COMPLETE",
    "RECORD_SHORTAGE",
    "RESUME_PICKING",
    "RESUME_READY_TO_PACK",
    "CANCEL",
    "ESCALATE",
  ]),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
/** Scoped fulfillment queue and explicit transition adapter. Core determines legal actions. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(request, params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(request, params);
  if (limit instanceof Response) return limit;
  return adminJson(
    await coreClient(env.CORE).listFulfillmentQueue({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
      cycleId: params.get("cycleId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}
async function POSTHandler(request: Request) {
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid(
      request,
      "locationId, orderId, action, and current expectedVersion are required",
    );
  try {
    const meta = commandMeta(request, parsed.data);
    return adminJson(
      await coreClient(env.CORE).advanceAdminFulfillment({
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

export const GET = observeAdminRoute("admin.fulfillment.get", GETHandler);

export const POST = observeAdminRoute("admin.fulfillment.post", POSTHandler);
