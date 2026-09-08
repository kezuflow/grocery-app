import { adminPromotionCreateBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
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

/** Thin same-origin BFF adapter for the promotion list. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminPromotions({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

/** Promotion creation: closed benefit set, validated authoritatively in Core. */
async function POSTHandler(request: Request) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, adminPromotionCreateBodySchema, { maxBytes: 8192 });
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
    await coreClient(env.CORE).createAdminPromotion({
      ...body.value,
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      idempotencyKey: key.data,
    }),
  );
}

export const GET = observeAdminRoute("admin.promotions.get", GETHandler);

export const POST = observeAdminRoute("admin.promotions.post", POSTHandler);
