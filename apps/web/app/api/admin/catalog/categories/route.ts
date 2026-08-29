import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapters for categories. Transport only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limitRaw = params.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const status = params.get("status");
  if (status !== null && status !== "active" && status !== "inactive") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status must be active or inactive",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).listAdminCategories({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    query: params.get("query") ?? undefined,
    status: status ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return Response.json(result);
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: crypto.randomUUID(),
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
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "code, name, and slug are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminCategory({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    code: body.code,
    name: body.name,
    slug: body.slug,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    parentCategoryId: typeof body.parentCategoryId === "string" ? body.parentCategoryId : null,
    iconAssetKey: typeof body.iconAssetKey === "string" ? body.iconAssetKey : null,
    idempotencyKey,
  });
  return Response.json(result);
}
