import { adminPromotionPreviewBodySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Read-only preview: never claims usage or mutates state. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const body = await readBoundedJson(request, adminPromotionPreviewBodySchema, { maxBytes: 8192 });
  if (!body.ok)
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: body.error.message,
          requestId: webRequestId(request),
        },
      },
      { status: body.error.status },
    );
  const result = await coreClient(env.CORE).previewAdminPromotion({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    promotionId,
    ...body.value,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.promotions.by_promotion_id.preview.post", POSTHandler);
