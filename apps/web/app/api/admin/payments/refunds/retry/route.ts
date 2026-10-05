import { z } from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

async function POSTHandler(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  const parsed = z
    .object({
      refundId: z.string().trim().min(1).max(200),
      expectedVersion: z.number().int().safe().positive(),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success || !idempotencyKey.trim() || idempotencyKey.length > 200)
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A refund, current version, reason and idempotency-key header are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).retryAdminRefund({
      ...parsed.data,
      idempotencyKey,
      requestId: webRequestId(request),
      headers: requestHeaders(request),
    }),
  );
}
export const POST = observeAdminRoute("admin.payments.refunds.retry.post", POSTHandler);
