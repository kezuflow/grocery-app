import type { AdminSkuPricesRequest, AdminSkuPricesView, RpcResult } from "@freshmarkets/contracts";
import { identifierSchema } from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../../validation";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";

const requestSchema = authenticatedRequestSchema.extend({
  skuId: identifierSchema,
  locationId: identifierSchema,
});

/** Global price history is independent of inventory and local activation authority. */
export async function getAdminSkuPrices(
  deps: CatalogAdministrationDeps,
  input: AdminSkuPricesRequest,
): Promise<RpcResult<AdminSkuPricesView>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "A SKU and location are required",
        requestId: input.requestId,
      },
    };
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "prices.read");
  if (!access.ok) return access;
  const target = await deps.db
    .prepare(`SELECT location.market_id marketId,market.currency,
      (location.status='active' AND market.status='active') active
    FROM fulfillment_location location JOIN market ON market.id=location.market_id
    WHERE location.id=? AND EXISTS (SELECT 1 FROM sku WHERE id=?)`)
    .bind(request.locationId, request.skuId)
    .first<{ marketId: string; currency: string; active: number }>();
  if (!target)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Price target not found", requestId: request.requestId },
    };
  const now = Date.now();
  const [history, current, manage] = await Promise.all([
    deps.db
      .prepare(`SELECT version,amount_minor amountMinor,currency,valid_from validFrom,valid_to validTo
      FROM price_version WHERE sku_id=? AND location_id=? AND price_type='STANDARD'
      ORDER BY version DESC LIMIT 25`)
      .bind(request.skuId, request.locationId)
      .all<AdminSkuPricesView["history"][number]>(),
    deps.db
      .prepare(`SELECT amount_minor amountMinor FROM price_version
      WHERE sku_id=? AND location_id=? AND currency=? AND price_type='STANDARD'
        AND valid_from<=? AND (valid_to IS NULL OR valid_to>?) ORDER BY version DESC LIMIT 1`)
      .bind(request.skuId, request.locationId, target.currency, now, now)
      .first<{ amountMinor: number }>(),
    resolveCatalogAdministrationAccess(deps, request, "prices.manage"),
  ]);
  return {
    ok: true,
    requestId: request.requestId,
    value: {
      skuId: request.skuId,
      locationId: request.locationId,
      marketId: target.marketId,
      currency: target.currency,
      latestVersion: history.results[0]?.version ?? 0,
      currentPriceMinor: current?.amountMinor ?? null,
      canManage: manage.ok && target.active === 1,
      history: history.results,
    },
  };
}
