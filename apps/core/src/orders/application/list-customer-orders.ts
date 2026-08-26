/**
 * Customer order-history list read model. Historical rows are snapshots;
 * this query never joins live catalog or address state.
 */
export async function listCustomerOrders(
  database: D1Database,
  query: { customerId: string; requestId: string },
): Promise<{
  ok: true;
  value: Array<{
    id: string;
    status: string;
    deliveryDate: string;
    totalMinor: number;
    currency: string;
    itemCount: number;
  }>;
  requestId: string;
}> {
  const rows = await database
    .prepare(
      "SELECT o.id,o.status,c.delivery_date,o.total_minor,o.currency,(SELECT COUNT(*) FROM order_item oi WHERE oi.order_id=o.id) item_count FROM grocery_order o JOIN delivery_cycle c ON c.id=o.cycle_id WHERE o.customer_id=? ORDER BY o.created_at DESC",
    )
    .bind(query.customerId)
    .all<{
      id: string;
      status: string;
      delivery_date: number;
      total_minor: number;
      currency: string;
      item_count: number;
    }>();
  return {
    ok: true as const,
    value: rows.results.map((r) => ({
      id: r.id,
      status: r.status,
      deliveryDate: new Date(r.delivery_date).toISOString(),
      totalMinor: r.total_minor,
      currency: r.currency,
      itemCount: r.item_count,
    })),
    requestId: query.requestId,
  };
}
