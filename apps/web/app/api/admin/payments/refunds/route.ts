import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Refund request: REQUESTED rows only; canonical outcomes come from the seam. */
async function POSTHandler(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    typeof body?.paymentIntentId !== "string" ||
    !Number.isInteger(body?.amountMinor) ||
    typeof body?.reason !== "string"
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "paymentIntentId, integer amountMinor, and reason are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).requestAdminRefund({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    paymentIntentId: body.paymentIntentId,
    amountMinor: body.amountMinor as number,
    reason: body.reason,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.payments.refunds.post", POSTHandler);
