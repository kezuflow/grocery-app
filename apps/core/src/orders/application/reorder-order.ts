import type { ReorderOrderRequest, ReorderResultView, RpcResult } from "@freshmarkets/contracts";
import { addCartItemsBatch, getCart } from "../../checkout/application/cart";

export async function reorderOrder(
  database: D1Database,
  command: ReorderOrderRequest & { customerId: string },
): Promise<RpcResult<ReorderResultView>> {
  const order = await database
    .prepare("SELECT id FROM grocery_order WHERE id=? AND customer_id=?")
    .bind(command.orderId, command.customerId)
    .first<{ id: string }>();
  if (!order)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: command.requestId },
    };
  const lines = await database
    .prepare(
      `SELECT sku_id AS skuId, product_name_snapshot AS productName, quantity
       FROM order_item WHERE order_id=? ORDER BY sku_id,id`,
    )
    .bind(command.orderId)
    .all<{ skuId: string; productName: string; quantity: number }>();
  const cart = await getCart(database, {
    customerId: command.customerId,
    requestId: command.requestId,
    headers: command.headers,
  });
  if (!cart.ok) return cart;
  const result = await addCartItemsBatch(database, {
    sourceOrderId: command.orderId,
    customerId: command.customerId,
    cartId: cart.value.id,
    expectedVersion: command.expectedCartVersion,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
    lines: lines.results,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      ...result.value,
      requiresFulfillmentReview: true,
      requiresAddressReview: true,
    },
    requestId: command.requestId,
  };
}
