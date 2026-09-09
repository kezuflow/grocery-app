import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";

const id = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(1000);
const cost = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const common = {
  locationId: id,
  jobId: id,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: id.optional(),
};
const schema = z.discriminatedUnion("action", [
  z.object({
    ...common,
    action: z.literal("ASSIGN"),
    reason,
    personName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }),
  z.object({ ...common, action: z.literal("HAND_OVER"), dispatchId: id }),
  z.object({ ...common, action: z.literal("COMPLETE"), dispatchId: id, actualCostMinor: cost }),
  z.object({ ...common, action: z.literal("FAIL"), dispatchId: id, reason, actualCostMinor: cost }),
]);

async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "Valid manual delivery details are required");
  let key: string;
  try {
    key = requireIdempotencyKey(request, parsed.data.idempotencyKey);
  } catch {
    return invalid(request, "A matching delivery request key is required");
  }
  return adminJson(
    await coreClient(env.CORE).manageManualDelivery({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
      idempotencyKey: key,
    }),
  );
}

export const POST = observeAdminRoute("admin.manual_deliveries.post", POSTHandler);
