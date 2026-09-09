import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { inventoryDistributionSchema } from "@freshmarkets/validation";
function invalid(request: Request, message: string, status = 400) {
  return adminJson(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: webRequestId(request) },
    },
    { status },
  );
}
export const GET = observeAdminRoute(
  "admin.inventory_distribution.get",
  async (request: Request) => {
    const parsed = inventoryDistributionSchema.safeParse({
      ...Object.fromEntries(new URL(request.url).searchParams),
      ...(new URL(request.url).searchParams.has("limit")
        ? { limit: Number(new URL(request.url).searchParams.get("limit")) }
        : {}),
    });
    if (!parsed.success) return invalid(request, "Check the inventory distribution filters");
    return adminJson(
      await coreClient(env.CORE).listInventoryDistribution({
        ...parsed.data,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
