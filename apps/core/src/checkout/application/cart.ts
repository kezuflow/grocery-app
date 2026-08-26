import type { AuthenticatedRequest, SetCartItemRequest } from "@freshmarkets/contracts";
import { activeFulfillmentLocationId, activeMarketCode } from "../../geography/market-defaults";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type CartView = {
  id: string;
  version: number;
  items: Array<{
    skuId: string;
    quantity: number;
    name: string;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  totalMinor: number;
  currency: string;
};

export type CartResult =
  | { ok: true; value: CartView; requestId: string }
  | ReturnType<typeof failure>;

/**
 * Load the customer's active cart, provisioning it against the default
 * fulfillment location on first touch. Prices resolve from the authoritative
 * market/location price context at read time; the cart itself reserves
 * nothing.
 */
export async function getCart(
  database: D1Database,
  input: AuthenticatedRequest & { customerId: string },
): Promise<CartResult> {
  let cart = await database
    .prepare(
      "SELECT id, location_id, version FROM cart WHERE customer_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(input.customerId)
    .first<{ id: string; location_id: string; version: number }>();
  if (!cart) {
    const locationId = await activeFulfillmentLocationId(
      database,
      await activeMarketCode(database),
    );
    if (!locationId)
      return failure(
        "CONFIGURATION_ERROR",
        "No active fulfillment location is configured",
        input.requestId,
      );
    cart = { id: crypto.randomUUID(), location_id: locationId, version: 1 };
    await database
      .prepare(
        "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)",
      )
      .bind(cart.id, input.customerId, locationId, Date.now(), Date.now())
      .run();
  }
  const currency = await database
    .prepare(
      "SELECT COALESCE(mcp.currency, m.currency) AS currency FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id WHERE fl.id=?",
    )
    .bind(cart.location_id)
    .first<{ currency: string }>();
  if (!currency)
    return failure(
      "CONFIGURATION_ERROR",
      "Cart market currency is not configured",
      input.requestId,
    );
  const now = Date.now();
  const rows = await database
    .prepare(
      "SELECT ci.sku_id, ci.quantity, s.name, COALESCE((SELECT amount_minor FROM price_version pv JOIN fulfillment_location fl ON fl.id=c.location_id WHERE pv.sku_id=s.id AND pv.market_id=fl.market_id AND pv.currency=? AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=c.location_id) AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1),0) AS unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN cart c ON c.id=ci.cart_id WHERE ci.cart_id=? ORDER BY s.sort_order",
    )
    .bind(currency.currency, now, now, cart.id)
    .all<{ sku_id: string; quantity: number; name: string; unit_price_minor: number }>();
  const items = rows.results.map((r) => ({
    skuId: r.sku_id,
    quantity: r.quantity,
    name: r.name,
    unitPriceMinor: r.unit_price_minor,
    lineTotalMinor: r.quantity * r.unit_price_minor,
  }));
  return {
    ok: true as const,
    value: {
      id: cart.id,
      version: cart.version,
      items,
      totalMinor: items.reduce((sum, i) => sum + i.lineTotalMinor, 0),
      currency: currency.currency,
    },
    requestId: input.requestId,
  };
}

/**
 * Set one SKU's quantity in the active cart (zero removes it) and bump the
 * cart version atomically. The cart stays an ordinary current cart; no stock
 * or capacity is reserved here.
 */
export async function setCartItem(
  database: D1Database,
  command: SetCartItemRequest & { customerId: string },
): Promise<CartResult> {
  const current = await getCart(database, command);
  if (!current.ok) return current;
  const sku = await database
    .prepare("SELECT id FROM sku WHERE id=? AND status='active'")
    .bind(command.skuId)
    .first<{ id: string }>();
  if (!sku) return failure("NOT_FOUND", "SKU not found", command.requestId);
  const statement =
    command.quantity > 0
      ? database
          .prepare(
            "INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, ?, ?) ON CONFLICT(cart_id, sku_id) DO UPDATE SET quantity=excluded.quantity",
          )
          .bind(current.value.id, command.skuId, command.quantity)
      : database
          .prepare("DELETE FROM cart_item WHERE cart_id=? AND sku_id=?")
          .bind(current.value.id, command.skuId);
  await database.batch([
    statement,
    database
      .prepare("UPDATE cart SET version=version+1, updated_at=? WHERE id=?")
      .bind(Date.now(), current.value.id),
  ]);
  return getCart(database, command);
}
