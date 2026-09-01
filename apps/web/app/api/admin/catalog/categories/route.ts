import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapters for categories. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limitRaw = params.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const status = params.get("status");
  if (status !== null && status !== "active" && status !== "inactive") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status must be active or inactive",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).listAdminCategories({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    query: params.get("query") ?? undefined,
    status: status ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

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
    typeof body?.code !== "string" ||
    typeof body?.name !== "string" ||
    typeof body?.slug !== "string"
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "code, name, and slug are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminCategory({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    code: body.code,
    name: body.name,
    slug: body.slug,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    parentCategoryId: typeof body.parentCategoryId === "string" ? body.parentCategoryId : null,
    iconAssetKey: typeof body.iconAssetKey === "string" ? body.iconAssetKey : null,
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.catalog.categories.get", GETHandler);

export const POST = observeAdminRoute("admin.catalog.categories.post", POSTHandler);
