import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** SKU creation. Transport only; dimension checks happen in Core. */
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
    typeof body?.productId !== "string" ||
    typeof body?.code !== "string" ||
    typeof body?.name !== "string" ||
    typeof body?.sellableUnitId !== "string" ||
    !Number.isInteger(body?.consumptionBaseQuantity)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message:
            "productId, code, name, sellableUnitId, and integer consumptionBaseQuantity are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminSku({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    productId: body.productId,
    code: body.code,
    name: body.name,
    sellableUnitId: body.sellableUnitId,
    consumptionBaseQuantity: body.consumptionBaseQuantity as number,
    merchandisingLabel:
      typeof body.merchandisingLabel === "string" ? body.merchandisingLabel : null,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    idempotencyKey,
  });
  return Response.json(result);
}
