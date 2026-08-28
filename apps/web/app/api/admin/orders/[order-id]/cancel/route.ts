import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Order cancellation through the canonical command. Transport only. */
export async function POST(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const { "order-id": orderId } = await context.params;
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
  const body = (await request.json().catch(() => null)) as {
    reason?: unknown;
    reasonCode?: unknown;
    resolution?: unknown;
    expectedVersion?: unknown;
  } | null;
  const reason = typeof body?.reason === "string" ? body.reason : body?.reasonCode;
  if (typeof reason !== "string" || !Number.isInteger(body?.expectedVersion)) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "reason and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const payload = body as { resolution?: unknown; expectedVersion: number };
  const result = await coreClient(env.CORE).cancelAdminOrder({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    orderId,
    reason,
    reasonCode: reason,
    resolution: typeof payload.resolution === "string" ? payload.resolution : undefined,
    expectedVersion: payload.expectedVersion,
    idempotencyKey,
  });
  return Response.json(result);
}
