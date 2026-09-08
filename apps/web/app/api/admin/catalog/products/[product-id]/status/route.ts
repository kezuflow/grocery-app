import { adminProductStatusBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
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
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, adminProductStatusBodySchema, { maxBytes: 32768 });
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
    await coreClient(env.CORE).setAdminProductStatus({
      ...body.value,
      productId: (await context.params)["product-id"],
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      idempotencyKey: key.data,
    }),
  );
}
export const POST = observeAdminRoute(
  "admin.catalog.products.by_product_id.status.post",
  POSTHandler,
);
