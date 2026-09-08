import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { z } from "@freshmarkets/validation";

/** Revoke every Better Auth session for the customer user. Transport only. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "customer-id": string }> },
) {
  const { "customer-id": customerId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
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
  const body = z
    .object({ reason: z.string().trim().min(1).max(500) })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success) {
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
  const result = await coreClient(env.CORE).revokeCustomerSessions({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    customerId,
    reason: body.data.reason,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.customers.by_customer_id.sessions.revoke.post",
  POSTHandler,
);
