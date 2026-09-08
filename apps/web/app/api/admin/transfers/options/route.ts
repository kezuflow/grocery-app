import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { inventoryTransferOptionsSchema } from "@freshmarkets/validation";
function invalid(request: Request, message: string, status = 400) {
  return adminJson(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: webRequestId(request) },
    },
    { status },
  );
}
export const GET = observeAdminRoute("admin.transfers.options.get", async (request: Request) => {
  const parsed = inventoryTransferOptionsSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(request, "Check the warehouse and product search");
  return adminJson(
    await coreClient(env.CORE).getInventoryTransferOptions({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
});
