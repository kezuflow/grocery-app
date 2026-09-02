import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** SKU location availability upsert. Transport only; Core authorizes. */
async function PUTHandler(request: Request, context: { params: Promise<{ "sku-id": string }> }) {
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
    typeof body?.locationId !== "string" ||
    (body?.availabilityStatus !== "AVAILABLE" && body?.availabilityStatus !== "UNAVAILABLE") ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "locationId, availabilityStatus, and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminSkuAvailability({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    skuId,
    locationId: body.locationId,
    availabilityStatus: body.availabilityStatus,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const PUT = observeAdminRoute("admin.catalog.skus.by_sku_id.availability.put", PUTHandler);
