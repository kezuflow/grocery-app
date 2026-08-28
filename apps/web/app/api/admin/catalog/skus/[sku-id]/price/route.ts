import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Versioned price insert. Transport only; Core authorizes and versions. */
export async function POST(request: Request, context: { params: Promise<{ "sku-id": string }> }) {
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
  if (
    typeof body?.marketId !== "string" ||
    typeof body?.currency !== "string" ||
    !Number.isInteger(body?.amountMinor)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "marketId, currency, and integer amountMinor are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminSkuPrice({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    skuId,
    marketId: body.marketId,
    currency: body.currency,
    amountMinor: body.amountMinor as number,
    idempotencyKey,
  });
  return Response.json(result);
}
