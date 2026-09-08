import { z } from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Queue read-only payment recovery; Core preserves the existing financial identity. */
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
      expectedVersion: z.number().int().safe().positive(),
      expectedRecoveryVersion: z.number().int().safe().nonnegative(),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A payment, current version and reason are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const result = await coreClient(env.CORE).recheckAdminPayment({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    paymentIntentId: body.paymentIntentId,
    expectedVersion: body.expectedVersion,
    expectedRecoveryVersion: body.expectedRecoveryVersion,
    reason: body.reason,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.payments.recheck.post", POSTHandler);
