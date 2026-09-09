import type { OrderAdditionOptionsView, RpcResult } from "@freshmarkets/contracts";
import { amendmentEligibility } from "../domain/amendment";

/** Named suggestions only; the addition command rechecks eligibility and prices when writing. */
export async function listOrderAdditionOptions(
  database: D1Database,
  input: { orderId: string; customerId: string; query?: string; requestId: string },
): Promise<RpcResult<OrderAdditionOptionsView>> {
  const order = await database
    .prepare(`SELECT o.status,o.currency,o.fulfillment_mode mode,
    f.location_id locationId,f.cutoff_at cutoffAt FROM grocery_order o
    JOIN order_fulfillment_snapshot f ON f.order_id=o.id WHERE o.id=? AND o.customer_id=?`)
    .bind(input.orderId, input.customerId)
    .first<{
      status: string;
      currency: string;
      mode: string;
      locationId: string;
      cutoffAt: number;
    }>();
  if (!order)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: input.requestId },
    };
  if (
    order.mode !== "SCHEDULED" ||
    !amendmentEligibility(order.status).eligible ||
    order.cutoffAt <= Date.now()
  )
    return {
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        message: "Additions are unavailable for this Order",
        requestId: input.requestId,
      },
    };
  const now = Date.now();
  const rows = await database
    .prepare(`SELECT s.id skuId,p.name productName,s.name variantName,
      pv.amount_minor priceMinor,pv.currency
    FROM sku s JOIN product p ON p.id=s.product_id
    JOIN sku_location_availability a ON a.sku_id=s.id AND a.location_id=? AND a.availability_status='AVAILABLE'
    JOIN fulfillment_location l ON l.id=a.location_id
    JOIN price_version pv ON pv.id=(SELECT price.id FROM price_version price
      WHERE price.sku_id=s.id AND price.location_id=l.id AND price.market_id=l.market_id
        AND price.currency=? AND price.price_type='STANDARD'
        AND price.valid_from<=? AND (price.valid_to IS NULL OR price.valid_to>?)
      ORDER BY price.version DESC LIMIT 1)
    WHERE s.status='active' AND p.status='active' AND pv.amount_minor>0
      AND instr(lower(p.name || ' ' || s.name),lower(?))>0
    ORDER BY p.name,s.name,s.id LIMIT 26`)
    .bind(order.locationId, order.currency, now, now, input.query?.trim() ?? "")
    .all<OrderAdditionOptionsView["items"][number]>();
  return {
    ok: true,
    value: { items: rows.results.slice(0, 25), hasMore: rows.results.length > 25 },
    requestId: input.requestId,
  };
}
