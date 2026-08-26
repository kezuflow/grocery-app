export type CreateOrderAmendmentCommand = {
  orderId: string;
  expectedOrderVersion: number;
  additions: ReadonlyArray<{ skuId: string; quantity: number }>;
  idempotencyKey: string;
  requestId: string;
};

export type OrderAmendmentView = {
  amendmentId: string;
  orderId: string;
  status: "DRAFT" | "PENDING_PAYMENT" | "COMMITTED" | "FAILED" | "CANCELED";
  totalMinor: number;
  currency: string;
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function toView(row: {
  id: string;
  order_id: string;
  status: OrderAmendmentView["status"];
  total_minor: number;
  currency: string;
}): OrderAmendmentView {
  return {
    amendmentId: row.id,
    orderId: row.order_id,
    status: row.status,
    totalMinor: row.total_minor,
    currency: row.currency,
  };
}

const SELECT =
  "SELECT id, order_id, status, total_minor, currency FROM paid_order_amendment WHERE idempotency_key=?";

/**
 * Create an additive amendment draft for a paid order. Lines are priced fresh
 * at amendment time and snapshotted immediately; the original order's lines,
 * totals, and payment history are never touched.
 */
export async function createOrderAmendment(
  database: D1Database,
  command: CreateOrderAmendmentCommand,
): Promise<
  { ok: true; value: OrderAmendmentView; requestId: string } | ReturnType<typeof failure>
> {
  const { amendmentEligibility } = await import("../domain/amendment");
  const replay = await database.prepare(SELECT).bind(command.idempotencyKey).first<{
    id: string;
    order_id: string;
    status: OrderAmendmentView["status"];
    total_minor: number;
    currency: string;
  }>();
  if (replay) return { ok: true, value: toView(replay), requestId: command.requestId };

  const order = await database
    .prepare(
      `SELECT o.id, o.status, o.version, o.currency,
              f.cycle_id, f.location_id, f.cutoff_at
       FROM grocery_order o LEFT JOIN order_fulfillment_snapshot f ON f.order_id=o.id WHERE o.id=?`,
    )
    .bind(command.orderId)
    .first<{
      id: string;
      status: string;
      version: number;
      currency: string;
      cycle_id: string | null;
      location_id: string | null;
      cutoff_at: number | null;
    }>();
  if (!order) return failure("NOT_FOUND", "Order not found", command.requestId);
  const eligibility = amendmentEligibility(order.status);
  if (!eligibility.eligible)
    return failure(
      "ILLEGAL_TRANSITION",
      `Order ${order.status} cannot be amended`,
      command.requestId,
    );
  if (order.version !== command.expectedOrderVersion)
    return failure("STALE_VERSION", "Order changed; refresh before retrying", command.requestId);
  // Post-cutoff additions follow cycle rules; MVP rejects past cutoff.
  if (order.cutoff_at !== null && order.cutoff_at <= Date.now())
    return failure(
      "CYCLE_CLOSED",
      "The cycle cutoff has passed; additions are not possible",
      command.requestId,
    );
  if (command.additions.length === 0)
    return failure("VALIDATION_FAILED", "Amendments may only add items", command.requestId);

  const amendmentId = crypto.randomUUID();
  const now = Date.now();
  let totalMinor = 0;
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        "INSERT INTO paid_order_amendment (id, order_id, status, currency, total_minor, idempotency_key, created_at, updated_at) VALUES (?, ?, 'PENDING_PAYMENT', ?, 0, ?, ?, ?)",
      )
      .bind(amendmentId, command.orderId, order.currency, command.idempotencyKey, now, now),
  ];
  for (const addition of command.additions) {
    const sku = await database
      .prepare(
        `SELECT s.name AS variant_name, s.sellable_unit_id AS unit, s.consumption_base_quantity,
                p.name AS product_name
         FROM sku s JOIN product p ON p.id=s.product_id WHERE s.id=?`,
      )
      .bind(addition.skuId)
      .first<{
        variant_name: string;
        unit: string;
        consumption_base_quantity: number;
        product_name: string;
      }>();
    if (!sku)
      return failure("UNAVAILABLE_ITEM", `Unknown SKU ${addition.skuId}`, command.requestId);
    const price = await database
      .prepare(
        `SELECT pv.amount_minor FROM price_version pv JOIN order_fulfillment_snapshot f ON f.order_id=?
         JOIN fulfillment_location fl ON fl.id=f.location_id
         WHERE pv.sku_id=? AND pv.market_id=fl.market_id AND pv.price_type='STANDARD'
           AND (pv.location_id IS NULL OR pv.location_id=f.location_id)
           AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
         ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1`,
      )
      .bind(command.orderId, addition.skuId, now, now)
      .first<{ amount_minor: number }>();
    if (!price)
      return failure(
        "PRICE_CHANGED",
        `No authoritative price for ${addition.skuId}`,
        command.requestId,
      );
    const baseQuantity = addition.quantity * sku.consumption_base_quantity;
    const lineTotal = price.amount_minor * addition.quantity;
    totalMinor += lineTotal;
    statements.push(
      database
        .prepare(
          "INSERT INTO paid_order_amendment_line (id, amendment_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, base_quantity, unit_price_minor, line_total_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          amendmentId,
          addition.skuId,
          sku.product_name,
          sku.variant_name,
          sku.unit,
          addition.quantity,
          baseQuantity,
          price.amount_minor,
          lineTotal,
          now,
        ),
    );
  }
  statements.push(
    database
      .prepare("UPDATE paid_order_amendment SET total_minor=?, updated_at=? WHERE id=?")
      .bind(totalMinor, now, amendmentId),
    database
      .prepare("UPDATE grocery_order SET version=version+1 WHERE id=? AND version=?")
      .bind(command.orderId, command.expectedOrderVersion),
  );
  await database.batch(statements);

  const stored = await database.prepare(SELECT).bind(command.idempotencyKey).first<{
    id: string;
    order_id: string;
    status: OrderAmendmentView["status"];
    total_minor: number;
    currency: string;
  }>();
  if (!stored) throw new Error("AMENDMENT_LOST");
  void failure;
  return { ok: true, value: toView(stored), requestId: command.requestId };
}
