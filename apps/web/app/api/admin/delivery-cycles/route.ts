import { env } from "cloudflare:workers";
import { z, deliveryCycleDraftSchema, identifierSchema } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";

const command = z.discriminatedUnion("action", [
  deliveryCycleDraftSchema.extend({ action: z.literal("SAVE") }),
  z
    .object({
      action: z.enum(["SCHEDULE", "CANCEL", "CLOSE_ORDERING"]),
      cycleId: identifierSchema,
      expectedVersion: z.number().int().safe().positive(),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export const GET = observeAdminRoute("admin.delivery-cycles.read", async (request: Request) => {
  const url = new URL(request.url);
  const metadata = {
    headers: requestHeaders(request),
    requestId: webRequestId(request),
    cursor: url.searchParams.get("cursor") ?? undefined,
  };
  const marketId = url.searchParams.get("marketId");
  const rangeStart = url.searchParams.get("rangeStart");
  const rangeEnd = url.searchParams.get("rangeEnd");
  return adminJson(
    marketId && !rangeStart && !rangeEnd
      ? await coreClient(env.CORE).listAdminCycleDestinations({ ...metadata, marketId })
      : await coreClient(env.CORE).listAdminDeliveryCycles({
          ...metadata,
          rangeStart: rangeStart ?? "",
          rangeEnd: rangeEnd ?? "",
          marketId: marketId ?? undefined,
          locationId: url.searchParams.get("locationId") ?? undefined,
          status:
            (url.searchParams.get("status") as
              | import("@freshmarkets/contracts").DeliveryCycleState
              | null) ?? undefined,
        }),
  );
});
export const POST = observeAdminRoute("admin.delivery-cycles.command", async (request: Request) => {
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "Check cycle details and schedule");
  const metadata = {
    headers: requestHeaders(request),
    requestId: webRequestId(request),
    idempotencyKey: requireIdempotencyKey(request),
  };
  if (parsed.data.action === "SAVE") {
    const { action: _action, ...draft } = parsed.data;
    return adminJson(
      await coreClient(env.CORE).saveAdminDeliveryCycleDraft({ ...draft, ...metadata }),
    );
  }
  const { action: _action, ...schedule } = parsed.data;
  if (parsed.data.action === "CANCEL")
    return adminJson(
      await coreClient(env.CORE).cancelAdminDeliveryCycle({ ...schedule, ...metadata }),
    );
  if (parsed.data.action === "CLOSE_ORDERING")
    return adminJson(
      await coreClient(env.CORE).closeAdminDeliveryCycleOrdering({ ...schedule, ...metadata }),
    );
  return adminJson(
    await coreClient(env.CORE).scheduleAdminDeliveryCycle({ ...schedule, ...metadata }),
  );
});
