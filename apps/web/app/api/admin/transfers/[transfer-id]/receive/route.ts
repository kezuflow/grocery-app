import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { z, receiveInventoryTransferSchema } from "@freshmarkets/validation";
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
export const POST = observeAdminRoute(
  "admin.transfers.by_transfer_id.receive.post",
  async (request: Request, context: { params: Promise<{ "transfer-id": string }> }) => {
    const { "transfer-id": transferId } = await context.params;
    const body = await readBoundedJson(request, z.record(z.string(), z.unknown()), {
      maxBytes: 16384,
    });
    if (!body.ok) return invalid(request, body.error.message, body.error.status);
    const parsed = receiveInventoryTransferSchema.safeParse({
      ...body.value,
      transferId,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (!parsed.success)
      return invalid(request, "Check the quantities, current transfer and reason");
    return adminJson(
      await coreClient(env.CORE).receiveInventoryTransfer({
        ...parsed.data,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
