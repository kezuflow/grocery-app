import { env } from "cloudflare:workers";
import { z, identifierSchema, locationOperatingScheduleSchema } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";
const command = z
  .object({
    locationId: identifierSchema,
    expectedVersion: z.number().int().safe().positive(),
    schedule: locationOperatingScheduleSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const GET = observeAdminRoute("admin.location-schedule.read", async (request: Request) =>
  adminJson(
    await coreClient(env.CORE).getAdminLocationSchedule({
      headers: requestHeaders(request),
      requestId: webRequestId(request),
      locationId: new URL(request.url).searchParams.get("locationId") ?? "",
    }),
  ),
);
export const POST = observeAdminRoute("admin.location-schedule.save", async (request: Request) => {
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "Check operating hours and closures");
  return adminJson(
    await coreClient(env.CORE).saveAdminLocationSchedule({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
      idempotencyKey: requireIdempotencyKey(request),
    }),
  );
});
