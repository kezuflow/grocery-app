import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Guarded inventory adjustment. Capability, operational location scope,
 * idempotency, version guard, and ledger evidence all happen in Core.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ "inventory-pool-id": string }> },
) {
  const { "inventory-pool-id": inventoryPoolId } = await context.params;
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
    typeof body?.locationId !== "string" ||
    typeof body?.delta !== "number" ||
    !Number.isInteger(body.delta) ||
    typeof body?.reason !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "locationId, integer delta, reason, and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).adjustInventory({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    locationId: body.locationId,
    inventoryPoolId,
    delta: body.delta,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
