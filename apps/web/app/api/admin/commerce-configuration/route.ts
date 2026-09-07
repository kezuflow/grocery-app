import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid } from "../operations-route-utils";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("PAUSE"),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  }),
  z.object({
    action: z.literal("SWITCH_MODE"),
    fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
    cadence: z.enum(["WEEKLY"]).nullable().optional(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  }),
  z.object({
    action: z.literal("OPEN"),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  }),
]);

async function GETHandler(request: Request) {
  return adminJson(
    await coreClient(env.CORE).getGlobalCommerceConfiguration({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
    }),
  );
}

async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "valid commerce transition is required");
  const common = {
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    expectedVersion: parsed.data.expectedVersion,
    reason: parsed.data.reason,
    idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
  };
  const result =
    parsed.data.action === "PAUSE"
      ? await coreClient(env.CORE).pauseSelling(common)
      : parsed.data.action === "OPEN"
        ? await coreClient(env.CORE).openSelling(common)
        : await coreClient(env.CORE).activateGlobalMode({
            ...common,
            fulfillmentMode: parsed.data.fulfillmentMode,
            cadence: parsed.data.cadence,
          });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.commerce_configuration.get", GETHandler);
export const POST = observeAdminRoute("admin.commerce_configuration.post", POSTHandler);
