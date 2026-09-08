import { adminProductUpdateBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one product detail. */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const { "product-id": productId } = await context.params;
  const params = new URL(request.url).searchParams;
  const scopeKind = params.get("scopeKind");
  const marketId = params.get("marketId")?.trim() ?? "";
  const locationId = params.get("locationId")?.trim() ?? "";
  if (
    scopeKind !== "GLOBAL" &&
    !(scopeKind === "LOCATION" && marketId.length > 0 && locationId.length > 0)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An explicit GLOBAL or LOCATION Product scope is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).getAdminProduct({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    productId,
    ...(scopeKind === "LOCATION"
      ? { scopeKind: "LOCATION" as const, marketId, locationId }
      : { scopeKind: "GLOBAL" as const }),
  });
  return adminJson(result);
}

async function PATCHHandler(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, adminProductUpdateBodySchema, { maxBytes: 32768 });
  if (!key.success || !body.ok)
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: !body.ok ? body.error.message : "An idempotency-key header is required",
          requestId: webRequestId(request),
        },
      },
      { status: !body.ok ? body.error.status : 400 },
    );
  return adminJson(
    await coreClient(env.CORE).updateAdminProduct({
      ...body.value,
      productId: (await context.params)["product-id"],
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      idempotencyKey: key.data,
    }),
  );
}
export const GET = observeAdminRoute("admin.catalog.products.by_product_id.get", GETHandler);

export const PATCH = observeAdminRoute("admin.catalog.products.by_product_id.patch", PATCHHandler);
