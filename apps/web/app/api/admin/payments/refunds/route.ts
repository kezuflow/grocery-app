import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Refund request: REQUESTED rows only; canonical outcomes come from the seam. */
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
    typeof body?.paymentIntentId !== "string" ||
    !Number.isInteger(body?.amountMinor) ||
    typeof body?.reason !== "string"
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "paymentIntentId, integer amountMinor, and reason are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).requestAdminRefund({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    paymentIntentId: body.paymentIntentId,
    amountMinor: body.amountMinor as number,
    reason: body.reason,
    idempotencyKey,
  });
  return Response.json(result);
}
