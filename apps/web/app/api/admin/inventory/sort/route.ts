import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { z, sortInventoryStockSchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
function invalid(request: Request, message: string, status = 400) {
  return adminJson(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: webRequestId(request) },
    },
    { status },
  );
}
export const POST = observeAdminRoute("admin.inventory.sort.post", async (request: Request) => {
  const body = await readBoundedJson(request, z.record(z.string(), z.unknown()), {
    maxBytes: 16384,
  });
  if (!body.ok) return invalid(request, body.error.message, body.error.status);
  const parsed = sortInventoryStockSchema.safeParse({
    ...body.value,
    idempotencyKey: request.headers.get("idempotency-key"),
  });
  if (!parsed.success)
    return invalid(request, "Check the measured grams, actual counts and reason");
  return adminJson(
    await coreClient(env.CORE).sortInventoryStock({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
});
