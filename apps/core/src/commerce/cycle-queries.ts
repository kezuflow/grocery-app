/**
 * Customer-facing Scheduled delivery-cycle browsing for a market. Capacity
 * remaining prefers cycle-zone-location allocations and falls back to legacy
 * cycle counters for historical rows.
 */
export async function listDeliveryCycles(
  database: D1Database,
  query: { marketCode?: string | null; requestId: string },
  resolveDefaultMarketCode: () => Promise<string | null>,
): Promise<{
  ok: true;
  value: Array<{
    id: string;
    name: string;
    cutoffAt: string;
    deliveryDate: string;
    status: string;
    capacityRemaining: number;
  }>;
  requestId: string;
}> {
  const marketCode = query.marketCode ?? (await resolveDefaultMarketCode());
  if (!marketCode) return { ok: true as const, value: [], requestId: query.requestId };
  const rows = await database
    .prepare(
      "SELECT dc.id, dc.name, dc.cutoff_at, dc.delivery_date, dc.status, COALESCE((SELECT MIN(czc.capacity-czc.allocated) FROM cycle_zone_capacity czc WHERE czc.cycle_id=dc.id), dc.capacity-dc.allocated) AS capacity_remaining FROM delivery_cycle dc JOIN market m ON m.id=dc.market_id WHERE m.code=? ORDER BY dc.delivery_date",
    )
    .bind(marketCode)
    .all<{
      id: string;
      name: string;
      cutoff_at: number;
      delivery_date: number;
      status: string;
      capacity_remaining: number;
    }>();
  return {
    ok: true as const,
    value: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      cutoffAt: new Date(r.cutoff_at).toISOString(),
      deliveryDate: new Date(r.delivery_date).toISOString(),
      status: r.status,
      capacityRemaining: r.capacity_remaining,
    })),
    requestId: query.requestId,
  };
}
