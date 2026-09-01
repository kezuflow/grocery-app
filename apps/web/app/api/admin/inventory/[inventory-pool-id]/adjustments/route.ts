import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Simple stock-in/stock-out adapter. Capability, operational location scope,
 * idempotency, version guard, stock invariants, and ledger evidence remain in Core.
 */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "inventory-pool-id": string }> },
) {
  const { "inventory-pool-id": inventoryPoolId } = await context.params;
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
    typeof body?.locationId !== "string" ||
    (body?.operation !== "ADD" && body?.operation !== "REMOVE") ||
    typeof body?.quantityBase !== "number" ||
    !Number.isInteger(body.quantityBase) ||
    body.quantityBase <= 0 ||
    typeof body?.reason !== "string" ||
    body.reason.trim() === "" ||
    !Number.isInteger(body?.expectedVersion) ||
    (body.expectedVersion as number) < 0
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message:
            "locationId, ADD or REMOVE operation, positive integer quantityBase, reason, and current expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).adjustInventory({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    locationId: body.locationId,
    inventoryPoolId,
    delta: body.operation === "ADD" ? body.quantityBase : -body.quantityBase,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.inventory.by_inventory_pool_id.adjustments.post",
  POSTHandler,
);
