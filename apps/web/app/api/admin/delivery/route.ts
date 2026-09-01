import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid, optionalLimit, requiredLocation } from "../operations-route-utils";

const bodySchema = z.object({
  locationId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  action: z.enum([
    "MARK_EN_ROUTE",
    "MARK_ARRIVED",
    "MARK_DELIVERED",
    "MARK_FAILED",
    "SCHEDULE_RETRY",
    "ESCALATE",
    "CANCEL",
  ]),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});

/** Scoped delivery dispatch queue and explicit lifecycle command adapter. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(request, params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(request, params);
  if (limit instanceof Response) return limit;
  return adminJson(
    await coreClient(env.CORE).listDeliveryOperations({
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
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return invalid(
      request,
      "locationId, orderId, action, and current expectedVersion are required",
    );
  try {
    const meta = commandMeta(request, parsed.data);
    return adminJson(
      await coreClient(env.CORE).advanceAdminDelivery({
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

export const GET = observeAdminRoute("admin.delivery.get", GETHandler);

export const POST = observeAdminRoute("admin.delivery.post", POSTHandler);
