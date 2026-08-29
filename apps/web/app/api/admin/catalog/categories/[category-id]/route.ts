import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

type Context = { params: Promise<{ "category-id": string }> };

export async function GET(request: Request, context: Context) {
  const categoryId = (await context.params)["category-id"];
  return Response.json(
    await coreClient(env.CORE).getAdminCategory({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      categoryId,
    }),
  );
}

export async function PATCH(request: Request, context: Context) {
  const categoryId = (await context.params)["category-id"];
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !idempotencyKey ||
    typeof body?.name !== "string" ||
    typeof body.slug !== "string" ||
    !(body.parentCategoryId === null || typeof body.parentCategoryId === "string") ||
    !(body.iconAssetKey === null || typeof body.iconAssetKey === "string") ||
    typeof body.sortOrder !== "number" ||
    !Number.isInteger(body.sortOrder) ||
    typeof body.expectedVersion !== "number" ||
    !Number.isInteger(body.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "Valid category fields, expectedVersion, and idempotency-key are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return Response.json(
    await coreClient(env.CORE).updateAdminCategory({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      categoryId,
      name: body.name,
      slug: body.slug,
      parentCategoryId: body.parentCategoryId,
      iconAssetKey: body.iconAssetKey,
      sortOrder: body.sortOrder,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    }),
  );
}
