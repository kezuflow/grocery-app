import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** SKU creation. Transport only; dimension checks happen in Core. */
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
    typeof body?.productId !== "string" ||
    typeof body?.code !== "string" ||
    typeof body?.name !== "string" ||
    typeof body?.sellableUnitId !== "string" ||
    !Number.isInteger(body?.sellQuantity) ||
    !Number.isInteger(body?.consumptionBaseQuantity)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message:
            "productId, code, name, sellableUnitId, sellQuantity, and consumptionBaseQuantity are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminSku({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    productId: body.productId,
    code: body.code,
    name: body.name,
    sellableUnitId: body.sellableUnitId,
    sellQuantity: body.sellQuantity as number,
    consumptionBaseQuantity: body.consumptionBaseQuantity as number,
    merchandisingLabel:
      typeof body.merchandisingLabel === "string" ? body.merchandisingLabel : null,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.catalog.skus.post", POSTHandler);
