import { z } from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Resolve an open reconciliation case. Transport only; Core authorizes. */
async function POSTHandler(request: Request, context: { params: Promise<{ "case-id": string }> }) {
  const { "case-id": caseId } = await context.params;
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
      reason: z.string().trim().min(1).max(500),
      expectedVersion: z.number().int().safe().positive(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A reason is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).resolveAdminReconciliationCase({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    caseId,
    reason: parsed.data.reason,
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.payments.reconciliation.by_case_id.resolve.post",
  POSTHandler,
);
