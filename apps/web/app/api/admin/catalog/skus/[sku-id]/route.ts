import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** SKU update. Transport only; Core owns version guards. */
export async function PATCH(request: Request, context: { params: Promise<{ "sku-id": string }> }) {
  const { "sku-id": skuId } = await context.params;
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
  if (!Number.isInteger(body?.expectedVersion)) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An integer expectedVersion is required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).updateAdminSku({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    skuId,
    name: typeof body?.name === "string" ? body.name : undefined,
    merchandisingLabel:
      typeof body?.merchandisingLabel === "string" ? body.merchandisingLabel : null,
    status: body?.status === "active" || body?.status === "inactive" ? body.status : undefined,
    sortOrder: typeof body?.sortOrder === "number" ? body.sortOrder : undefined,
    expectedVersion: body!.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
