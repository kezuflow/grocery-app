import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Versioned price insert. Transport only; Core authorizes and versions. */
async function POSTHandler(request: Request, context: { params: Promise<{ "sku-id": string }> }) {
  const { "sku-id": skuId } = await context.params;
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
    typeof body?.marketId !== "string" ||
    (body?.locationId !== null && typeof body?.locationId !== "string") ||
    typeof body?.currency !== "string" ||
    !Number.isInteger(body?.amountMinor) ||
    !Number.isInteger(body?.validFrom) ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message:
            "marketId, nullable locationId, currency, amountMinor, validFrom, and expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminSkuPrice({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    skuId,
    marketId: body.marketId,
    locationId: body.locationId as string | null,
    currency: body.currency,
    amountMinor: body.amountMinor as number,
    validFrom: body.validFrom as number,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.catalog.skus.by_sku_id.price.post", POSTHandler);
