/**
 * Customer order-history list read model. Historical rows are snapshots;
 * this query never joins live catalog or address state.
 */
export async function listCustomerOrders(
  database: D1Database,
  query: { customerId: string; requestId: string },
): Promise<RpcResult<ReadonlyArray<CustomerOrderView>>> {
  const rows = await database
    .prepare(
      `SELECT o.id,o.order_number,o.status,o.fulfillment_mode,
              ofs.delivery_date,ofs.promised_at,COALESCE(o.committed_at,o.created_at) committed_at,
              o.total_minor,o.currency,
              (SELECT COUNT(*) FROM order_item oi WHERE oi.order_id=o.id) item_count
       FROM grocery_order o
       LEFT JOIN order_fulfillment_snapshot ofs ON ofs.order_id=o.id
       WHERE o.customer_id=? ORDER BY committed_at DESC,o.id DESC`,
    )
    .bind(query.customerId)
    .all<{
      id: string;
      order_number: string | null;
      status: string;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      delivery_date: number | null;
      promised_at: number | null;
      committed_at: number;
      total_minor: number;
      currency: string;
      item_count: number;
    }>();
  return {
    ok: true as const,
    value: rows.results.map((r) => ({
      id: r.id,
      orderNumber: r.order_number ?? r.id,
      status: r.status as ImplementedOrderState,
      fulfillmentMode: r.fulfillment_mode,
      deliveryDate: r.delivery_date === null ? null : new Date(r.delivery_date).toISOString(),
      promisedAt: r.promised_at === null ? null : new Date(r.promised_at).toISOString(),
      committedAt: new Date(r.committed_at).toISOString(),
      totalMinor: r.total_minor,
      currency: r.currency,
      itemCount: r.item_count,
    })),
    requestId: query.requestId,
  };
}
import type { CustomerOrderView, ImplementedOrderState, RpcResult } from "@freshmarkets/contracts";
