import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { requestHeaders } from "../../../lib/core-client/request";
export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, any>;
  const common = {
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    idempotencyKey: String(body.idempotencyKey ?? crypto.randomUUID()),
  };
  const core = env.CORE as unknown as CoreServiceBinding;
  if (body.command === "inventory")
    return Response.json(
      await core.adjustInventory({
        ...common,
        locationId: body.locationId,
        inventoryPoolId: body.inventoryPoolId,
        delta: Number(body.delta),
        reason: String(body.reason),
      }),
    );
  if (body.command === "procurement")
    return Response.json(
      await core.createProcurementRequirement({
        ...common,
        deliveryCycleId: body.deliveryCycleId,
        locationId: body.locationId,
        inventoryPoolId: body.inventoryPoolId,
        quantity: Number(body.quantity),
      }),
    );
  if (body.command === "receiving")
    return Response.json(
      await core.receiveProcurement({
        ...common,
        requirementId: body.requirementId,
        acceptedQuantity: Number(body.acceptedQuantity),
        rejectedQuantity: Number(body.rejectedQuantity),
        reason: body.reason,
      }),
    );
  if (body.command === "fulfillment")
    return Response.json(
      await core.advanceFulfillment({ ...common, orderId: body.orderId, action: body.action }),
    );
  if (body.command === "delivery")
    return Response.json(
      await core.advanceDelivery({ ...common, orderId: body.orderId, action: body.action }),
    );
  return Response.json(
    {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Unknown command", requestId: common.requestId },
    },
    { status: 400 },
  );
}
