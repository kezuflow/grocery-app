import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid } from "../../operations-route-utils";
const schema = z.object({
  locationId: z.string().trim().min(1),
  requirementId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid(request, "locationId, requirementId, and current expectedVersion are required");
  try {
    const meta = commandMeta(request, parsed.data);
    return adminJson(
      await coreClient(env.CORE).startAdminReceiving({
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

export const POST = observeAdminRoute("admin.receiving.start.post", POSTHandler);
