import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { z } from "@freshmarkets/validation";

/** Disable or restore commerce access. Transport only; Core authorizes. */
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
    .object({
      action: z.enum(["DISABLE", "RESTORE"]),
      reason: z.string().trim().min(1).max(500),
      expectedVersion: z.number().int().positive(),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "action, reason, and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).changeCustomerAccess({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    customerId,
    ...body.data,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.customers.by_customer_id.access.post", POSTHandler);
