import { env } from "cloudflare:workers";
import {
  identifierSchema,
  serviceAreaDefinitionSchema,
  serviceCoordinateSchema,
  z,
} from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";

const schema = z.discriminatedUnion("action", [
  serviceAreaDefinitionSchema.extend({
    action: z.literal("PUBLISH"),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(500),
  }),
  serviceCoordinateSchema.extend({ action: z.literal("PREVIEW"), marketId: identifierSchema }),
]);

export const GET = observeAdminRoute("admin.serviceability.read", async (request: Request) =>
  adminJson(
    await coreClient(env.CORE).getAdminServiceability({
      headers: requestHeaders(request),
      requestId: webRequestId(request),
      cursor: new URL(request.url).searchParams.get("cursor") ?? undefined,
    }),
  ),
);

export const POST = observeAdminRoute("admin.serviceability.command", async (request: Request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "Check service-area details and coordinates");
  const metadata = { headers: requestHeaders(request), requestId: webRequestId(request) };
  return adminJson(
    parsed.data.action === "PREVIEW"
      ? await coreClient(env.CORE).previewAdminServiceability({ ...parsed.data, ...metadata })
      : await coreClient(env.CORE).publishAdminServiceArea({
          ...parsed.data,
          ...metadata,
          idempotencyKey: requireIdempotencyKey(request),
        }),
  );
});
