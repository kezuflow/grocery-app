import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../lib/core-client/request";
const operationBodySchema = z.object({
  command: z.enum(["inventory", "procurement", "receiving", "fulfillment", "delivery", "orders"]),
  locationId: z.string().trim().min(1).optional(),
  inventoryPoolId: z.string().trim().min(1).optional(),
  deliveryCycleId: z.string().trim().min(1).optional(),
  requirementId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  delta: z.coerce.number().int().finite().optional(),
  quantity: z.coerce.number().int().positive().optional(),
  acceptedQuantity: z.coerce.number().int().nonnegative().optional(),
  rejectedQuantity: z.coerce.number().int().nonnegative().optional(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
  expectedVersion: z.coerce.number().int().nonnegative().optional(),
});
export async function POST(request: Request) {
  const parsed = operationBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid operation request" } },
      { status: 400 },
    );
  const body = parsed.data;
  const common = {
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    idempotencyKey: String(body.idempotencyKey ?? crypto.randomUUID()),
  };
  const core = env.CORE as unknown as CoreServiceBinding;
  if (body.command === "inventory") {
    if (
      !body.locationId ||
      !body.inventoryPoolId ||
      body.delta === undefined ||
      !body.reason ||
      body.expectedVersion === undefined
    )
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Inventory fields including expectedVersion are required",
            requestId: common.requestId,
          },
        },
        { status: 400 },
      );
    return Response.json(
      await core.adjustInventory({
        ...common,
        locationId: body.locationId,
        inventoryPoolId: body.inventoryPoolId,
        delta: body.delta,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
  if (body.command === "procurement") {
    if (
      !body.deliveryCycleId ||
      !body.locationId ||
      !body.inventoryPoolId ||
      body.quantity === undefined ||
      body.expectedVersion === undefined
    )
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Procurement fields including expectedVersion are required",
            requestId: common.requestId,
          },
        },
        { status: 400 },
      );
    return Response.json(
      await core.createProcurementRequirement({
        ...common,
        deliveryCycleId: body.deliveryCycleId,
        locationId: body.locationId,
        inventoryPoolId: body.inventoryPoolId,
        quantity: body.quantity,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
  if (body.command === "receiving") {
    if (
      !body.requirementId ||
      body.acceptedQuantity === undefined ||
      body.rejectedQuantity === undefined ||
      body.expectedVersion === undefined
    )
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Receiving fields including expectedVersion are required",
            requestId: common.requestId,
          },
        },
        { status: 400 },
      );
    return Response.json(
      await core.receiveProcurement({
        ...common,
        requirementId: body.requirementId,
        acceptedQuantity: body.acceptedQuantity,
        rejectedQuantity: body.rejectedQuantity,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
  if (body.command === "fulfillment") {
    const action = z.enum(["START", "PACK", "SHORTAGE"]).safeParse(body.action);
    if (!body.orderId || !action.success || body.expectedVersion === undefined)
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Fulfillment fields including expectedVersion are required",
            requestId: common.requestId,
          },
        },
        { status: 400 },
      );
    return Response.json(
      await core.advanceFulfillment({
        ...common,
        orderId: body.orderId,
        action: action.data,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
  if (body.command === "delivery") {
    const action = z.enum(["DISPATCH", "DELIVER", "FAIL"]).safeParse(body.action);
    if (!body.orderId || !action.success || body.expectedVersion === undefined)
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Delivery fields including expectedVersion are required",
            requestId: common.requestId,
          },
        },
        { status: 400 },
      );
    return Response.json(
      await core.advanceDelivery({
        ...common,
        orderId: body.orderId,
        action: action.data,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
  if (body.command === "orders") {
    const action = z.enum(["CANCEL", "REFUND"]).safeParse(body.action);
    if (!body.orderId || !body.reason || !action.success || body.expectedVersion === undefined)
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Order command fields including expectedVersion are required",
            requestId: common.requestId,
          },
        },
        { status: 400 },
      );
    const result = await core.advanceOrder({
      ...common,
      orderId: body.orderId,
      action: action.data,
      reason: body.reason,
      expectedVersion: body.expectedVersion,
    });
    if (!result.ok && result.error.code === "FINANCIAL_OPERATION_REQUIRES_REVIEW")
      return Response.json(result, { status: 409 });
    return Response.json(result);
  }
  return Response.json(
    {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Unknown command", requestId: common.requestId },
    },
    { status: 400 },
  );
}
