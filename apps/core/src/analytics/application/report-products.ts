import type { AnalyticsOverviewView, Scope } from "@freshmarkets/contracts";
import { AnalyticsDefinitionValidationError } from "../metric-definitions";

/** Analytics readers can select retained purchased options without catalog-write access. */
export async function listReportProducts(
  database: D1Database,
  scope: Scope,
  input: { search?: string; cursor?: string },
): Promise<NonNullable<AnalyticsOverviewView["productOptions"]>> {
  if (
    (input.search !== undefined &&
      (typeof input.search !== "string" || input.search.length > 100)) ||
    (input.cursor !== undefined && (typeof input.cursor !== "string" || input.cursor.length > 2048))
  )
    throw new AnalyticsDefinitionValidationError("Product search or cursor is invalid");
  const search = input.search?.trim() ?? "";
  const binding = JSON.stringify({ scope, search });
  let after = "";
  if (input.cursor) {
    try {
      const decoded = JSON.parse(decodeURIComponent(input.cursor)) as {
        binding?: unknown;
        after?: unknown;
      };
      if (
        decoded.binding !== binding ||
        typeof decoded.after !== "string" ||
        !decoded.after ||
        decoded.after.length > 200
      )
        throw new Error("Cursor does not match scope and search");
      after = decoded.after;
    } catch {
      throw new AnalyticsDefinitionValidationError(
        "Product cursor does not match this search and scope",
      );
    }
  }
  const clause =
    scope.kind === "global"
      ? ""
      : scope.kind === "location"
        ? " AND snapshot.location_id=?"
        : " AND snapshot.location_id IN (SELECT id FROM fulfillment_location WHERE market_id=?)";
  const binds =
    scope.kind === "global" ? [] : [scope.kind === "location" ? scope.locationId : scope.marketId];
  const result = await database
    .prepare(`WITH lines AS (
    SELECT line.order_id,line.sku_id,line.product_name_snapshot,line.variant_name_snapshot
    FROM order_item line JOIN order_payment_reaction commitment ON commitment.order_id=line.order_id
    UNION ALL
    SELECT amendment.order_id,line.sku_id,line.product_name_snapshot,line.variant_name_snapshot
    FROM paid_order_amendment_line line JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
    WHERE amendment.status='COMMITTED'
  ) SELECT lines.sku_id AS skuId,MAX(lines.product_name_snapshot) AS productName,
    MAX(lines.variant_name_snapshot) AS optionName
  FROM lines LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=lines.order_id
  WHERE lines.sku_id>? AND (?='' OR instr(lower(lines.product_name_snapshot||' '||lines.variant_name_snapshot),lower(?))>0)
    ${clause} GROUP BY lines.sku_id ORDER BY lines.sku_id LIMIT 26`)
    .bind(after, search, search, ...binds)
    .all<{ skuId: string; productName: string; optionName: string }>();
  const items = result.results.slice(0, 25);
  return {
    items,
    nextCursor:
      result.results.length > 25
        ? encodeURIComponent(JSON.stringify({ binding, after: items[items.length - 1]!.skuId }))
        : null,
  };
}
