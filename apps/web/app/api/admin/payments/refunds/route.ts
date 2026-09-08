import { z } from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Versioned refund decision; Core owns admission and provider execution. */
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
  const parsed = z
    .object({
      paymentIntentId: z.string().trim().min(1).max(200),
      amountMinor: z.number().int().safe().positive(),
      expectedVersion: z.number().int().safe().positive(),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A payment, exact amount, current version and reason are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const result = await coreClient(env.CORE).requestAdminRefund({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    paymentIntentId: body.paymentIntentId,
    amountMinor: body.amountMinor,
    expectedVersion: body.expectedVersion,
    reason: body.reason,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.payments.refunds.post", POSTHandler);
