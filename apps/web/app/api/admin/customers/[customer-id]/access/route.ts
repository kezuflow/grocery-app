import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Disable or restore commerce access. Transport only; Core authorizes. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "customer-id": string }> },
) {
  const { "customer-id": customerId } = await context.params;
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
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    (body?.action !== "DISABLE" && body?.action !== "RESTORE") ||
    typeof body?.reason !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
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
    action: body.action as "DISABLE" | "RESTORE",
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.customers.by_customer_id.access.post", POSTHandler);
