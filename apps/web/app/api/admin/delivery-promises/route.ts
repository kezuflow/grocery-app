import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid } from "../operations-route-utils";

const identity = z.string().trim().min(1).max(200);
const schema = z.object({
  locationId: identity,
  jobId: identity,
  expectedVersion: z.number().int().positive(),
  promisedAt: z.string().datetime(),
  agreementNote: z.string().trim().min(1).max(1000),
  idempotencyKey: identity.optional(),
});
async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid(request, "Enter the agreed delivery time and customer agreement");
  let key: string;
  try {
    key = requireIdempotencyKey(request, parsed.data.idempotencyKey);
  } catch {
    return invalid(request, "A matching agreement request key is required");
  }
  return adminJson(
    await coreClient(env.CORE).reviseDeliveryPromise({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
      idempotencyKey: key,
    }),
  );
}
export const POST = observeAdminRoute("admin.delivery_promises.post", POSTHandler);
