import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Activate or deactivate a product. Transport only; Core authorizes. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const { "product-id": productId } = await context.params;
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
    status?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    (body?.status !== "active" && body?.status !== "inactive") ||
    typeof body?.reason !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status, reason, and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminProductStatus({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    productId,
    status: body.status,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.catalog.products.by_product_id.status.post",
  POSTHandler,
);
