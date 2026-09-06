import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";

const bodySchema = z.object({
  locationId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  providerCode: z.literal("lalamove"),
  pickup: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("IMMEDIATE") }),
    z.object({ kind: z.literal("SCHEDULED"), pickupAt: z.string().datetime({ offset: true }) }),
  ]),
  idempotencyKey: z.string().trim().min(1).optional(),
});

async function POSTHandler(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "A valid external delivery request is required");
  try {
    return adminJson(
      await coreClient(env.CORE).requestExternalDelivery({
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

export const POST = observeAdminRoute("admin.external_deliveries.post", POSTHandler);
