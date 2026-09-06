/**
 * Customer-facing Scheduled delivery-cycle browsing for a market. Cycles are
 * constrained only by lifecycle and cutoff; Scheduled commerce has no capacity.
 */
export async function listDeliveryCycles(
  database: D1Database,
  query: { marketCode?: string | null; requestId: string },
  resolveDefaultMarketCode: () => Promise<string | null>,
): Promise<RpcResult<ReadonlyArray<DeliveryCycleView>>> {
  const marketCode = query.marketCode ?? (await resolveDefaultMarketCode());
  if (!marketCode) return { ok: true as const, value: [], requestId: query.requestId };
  const rows = await database
    .prepare(
      "SELECT dc.id, dc.name, dc.cutoff_at, dc.delivery_date, dc.status FROM delivery_cycle dc JOIN market m ON m.id=dc.market_id WHERE m.code=? ORDER BY dc.delivery_date",
    )
    .bind(marketCode)
    .all<{
      id: string;
      name: string;
      cutoff_at: number;
      delivery_date: number;
      status: string;
    }>();
  return {
    ok: true as const,
    value: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      cutoffAt: new Date(r.cutoff_at).toISOString(),
      deliveryDate: new Date(r.delivery_date).toISOString(),
      status: r.status as DeliveryCycleState,
    })),
    requestId: query.requestId,
  };
}
import type { DeliveryCycleState, DeliveryCycleView, RpcResult } from "@freshmarkets/contracts";
