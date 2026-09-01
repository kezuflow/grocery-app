import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, requiredLocation } from "../operations-route-utils";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

const schema = z.object({
  locationId: z.string().trim().min(1),
  fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
  cadence: z.enum(["WEEKLY"]).nullable().optional(),
  promiseMinutes: z.number().int().positive().nullable().optional(),
  maxConcurrentInstantOrders: z.number().int().positive().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().nullable(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
async function GETHandler(request: Request) {
  const locationId = requiredLocation(request, new URL(request.url).searchParams);
  if (locationId instanceof Response) return locationId;
  return adminJson(
    await coreClient(env.CORE).getFulfillmentMode({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
    }),
  );
}
async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "valid fulfillment mode configuration is required");
  try {
    return adminJson(
      await coreClient(env.CORE).activateFulfillmentMode({
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        ...parsed.data,
        idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
      }),
    );
  } catch (error) {
    return invalid(request, (error as Error).message);
  }
}

export const GET = observeAdminRoute("admin.fulfillment_mode.get", GETHandler);

export const POST = observeAdminRoute("admin.fulfillment_mode.post", POSTHandler);
