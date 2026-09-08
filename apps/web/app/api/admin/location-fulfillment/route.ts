import { env } from "cloudflare:workers";
import { z, identifierSchema, locationFulfillmentSettingsSchema } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";
const command = locationFulfillmentSettingsSchema
  .extend({
    locationId: identifierSchema,
    expectedVersion: z.number().int().safe().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const GET = observeAdminRoute("admin.location-fulfillment.read", async (request: Request) =>
  adminJson(
    await coreClient(env.CORE).getAdminLocationFulfillment({
      headers: requestHeaders(request),
      requestId: webRequestId(request),
      locationId: new URL(request.url).searchParams.get("locationId") ?? "",
    }),
  ),
);
export const POST = observeAdminRoute(
  "admin.location-fulfillment.configure",
  async (request: Request) => {
    const parsed = command.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(request, "Check fulfillment settings and reason");
    return adminJson(
      await coreClient(env.CORE).configureAdminLocationFulfillment({
        ...parsed.data,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
        idempotencyKey: requireIdempotencyKey(request),
      }),
    );
  },
);
