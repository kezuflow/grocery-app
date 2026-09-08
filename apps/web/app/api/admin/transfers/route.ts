import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import {
  z,
  createInventoryTransferSchema,
  inventoryTransferListSchema,
} from "@freshmarkets/validation";
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
export const GET = observeAdminRoute("admin.transfers.get", async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const parsed = inventoryTransferListSchema.safeParse({
    ...Object.fromEntries(params),
    ...(params.has("limit") ? { limit: Number(params.get("limit")) } : {}),
  });
  if (!parsed.success) return invalid(request, "Check the transfer filters");
  return adminJson(
    await coreClient(env.CORE).listInventoryTransfers({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
});
export const POST = observeAdminRoute("admin.transfers.post", async (request: Request) => {
  const body = await readBoundedJson(request, z.record(z.string(), z.unknown()), {
    maxBytes: 16384,
  });
  if (!body.ok) return invalid(request, body.error.message, body.error.status);
  const parsed = createInventoryTransferSchema.safeParse({
    ...body.value,
    idempotencyKey: request.headers.get("idempotency-key"),
  });
  if (!parsed.success)
    return invalid(
      request,
      "Select a warehouse, destination and positive whole-unit quantities; give a reason",
    );
  return adminJson(
    await coreClient(env.CORE).createInventoryTransfer({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
});
