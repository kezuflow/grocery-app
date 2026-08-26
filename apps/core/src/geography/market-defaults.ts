/**
 * Persisted market/location default resolution for the single active MVP
 * market and fulfillment location. Geography and Assignment owns these
 * defaults; callers compose them, never hard-code them.
 */
export async function activeMarketCode(database: D1Database): Promise<string | null> {
  const row = await database
    .prepare("SELECT code FROM market WHERE status='active' AND is_default=1")
    .first<{ code: string }>();
  return row?.code ?? null;
}

export async function activeFulfillmentLocationId(
  database: D1Database,
  marketCode: string | null,
): Promise<string | null> {
  const row = await database
    .prepare(
      "SELECT fl.id FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id WHERE fl.status='active' AND fl.is_default=1 AND m.status='active' AND (? IS NULL OR m.code=?)",
    )
    .bind(marketCode, marketCode)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function defaultCurrency(database: D1Database): Promise<string | null> {
  const row = await database
    .prepare(
      "SELECT COALESCE(mcp.currency, m.currency) AS currency FROM market m LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id WHERE m.status='active' AND m.is_default=1",
    )
    .first<{ currency: string }>();
  return row?.currency ?? null;
}
