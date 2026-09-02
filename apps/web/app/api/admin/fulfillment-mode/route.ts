import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid } from "../operations-route-utils";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

const schema = z.object({
  fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
  cadence: z.enum(["WEEKLY"]).nullable().optional(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
async function GETHandler(request: Request) {
  return adminJson(
    await coreClient(env.CORE).getFulfillmentMode({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
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
