import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams, requestId: string): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: requestId,
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

/** Read-only grant listing for one promotion. Transport only. */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listPromotionGrants({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    promotionId,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

/** Targeted grant to one customer. Transport only; Core authorizes. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
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
    customerId?: unknown;
    maxRedemptions?: unknown;
  } | null;
  if (typeof body?.customerId !== "string" || !Number.isInteger(body?.maxRedemptions)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "customerId and integer maxRedemptions are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).grantAdminPromotion({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    promotionId,
    customerId: body.customerId,
    maxRedemptions: body.maxRedemptions as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.promotions.by_promotion_id.grants.get", GETHandler);

export const POST = observeAdminRoute("admin.promotions.by_promotion_id.grants.post", POSTHandler);
