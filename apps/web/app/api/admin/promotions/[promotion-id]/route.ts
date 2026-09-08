import { adminPromotionUpdateBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one promotion definition. */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const result = await coreClient(env.CORE).getAdminPromotion({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    promotionId,
  });
  return adminJson(result);
}

/** Draft-definition update. Transport only; Core owns the lifecycle rules. */
async function PATCHHandler(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, adminPromotionUpdateBodySchema, { maxBytes: 8192 });
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
    await coreClient(env.CORE).updateAdminPromotion({
      ...body.value,
      promotionId,
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      idempotencyKey: key.data,
    }),
  );
}

export const GET = observeAdminRoute("admin.promotions.by_promotion_id.get", GETHandler);

export const PATCH = observeAdminRoute("admin.promotions.by_promotion_id.patch", PATCHHandler);
