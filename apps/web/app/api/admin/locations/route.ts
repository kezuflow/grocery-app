import { env } from "cloudflare:workers";
import {
  z,
  adminLocationDetailsSchema,
  locationPurposeSchema,
  identifierSchema,
} from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";

const common = { reason: z.string().trim().min(1).max(500) };
const schema = z.discriminatedUnion("action", [
  adminLocationDetailsSchema.extend({
    ...common,
    action: z.literal("CREATE"),
    marketId: identifierSchema,
    code: z.string(),
    purpose: locationPurposeSchema,
  }),
  adminLocationDetailsSchema.extend({
    ...common,
    action: z.literal("UPDATE"),
    locationId: identifierSchema,
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    ...common,
    action: z.enum(["ACTIVATE", "DEACTIVATE"]),
    locationId: identifierSchema,
    expectedVersion: z.number().int().positive(),
  }),
]);
async function GETHandler(request: Request) {
  return adminJson(
    await coreClient(env.CORE).listAdminLocations({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      cursor: new URL(request.url).searchParams.get("cursor") ?? undefined,
    }),
  );
}
async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "Check the location details and command");
  const requestMeta = {
    headers: requestHeaders(request),
    requestId: webRequestId(request),
    idempotencyKey: requireIdempotencyKey(request),
  };
  const input = parsed.data;
  return adminJson(
    input.action === "CREATE"
      ? await coreClient(env.CORE).createAdminLocation({ ...input, ...requestMeta })
      : input.action === "UPDATE"
        ? await coreClient(env.CORE).updateAdminLocation({ ...input, ...requestMeta })
        : await coreClient(env.CORE).transitionAdminLocation({ ...input, ...requestMeta }),
  );
}
export const GET = observeAdminRoute("admin.locations.list", GETHandler);
export const POST = observeAdminRoute("admin.locations.command", POSTHandler);
