import type { QuoteLine } from "../domain/quote";

export type CheckoutQuoteRow = {
  id: string;
  attemptId: string;
  customerId: string;
  cartId: string;
  addressId: string;
  deliveryCycleId: string | null;
  fulfillmentMode?: "INSTANT" | "SCHEDULED";
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  lines: QuoteLine[];
  addressSnapshot: unknown;
  cycleSnapshot: unknown;
  fulfillmentSnapshot: unknown;
  status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "SUPERSEDED";
  version: number;
  expiresAt: number;
};

const COLUMNS =
  "id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json, address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version, expires_at";

type RawRow = {
  id: string;
  attempt_id: string;
  customer_id: string;
  cart_id: string;
  address_id: string;
  delivery_cycle_id: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  delivery_fee_minor: number;
  total_minor: number;
  lines_json: string;
  address_snapshot_json: string | null;
  cycle_snapshot_json: string | null;
  fulfillment_snapshot_json: string | null;
  status: CheckoutQuoteRow["status"];
  version: number;
  expires_at: number;
};

function map(row: RawRow): CheckoutQuoteRow {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    customerId: row.customer_id,
    cartId: row.cart_id,
    addressId: row.address_id,
    deliveryCycleId: row.delivery_cycle_id,
    currency: row.currency,
    subtotalMinor: row.subtotal_minor,
    discountMinor: row.discount_minor,
    deliveryFeeMinor: row.delivery_fee_minor,
    totalMinor: row.total_minor,
    lines: JSON.parse(row.lines_json) as QuoteLine[],
    addressSnapshot: row.address_snapshot_json ? JSON.parse(row.address_snapshot_json) : null,
    cycleSnapshot: row.cycle_snapshot_json ? JSON.parse(row.cycle_snapshot_json) : null,
    fulfillmentSnapshot: row.fulfillment_snapshot_json
      ? JSON.parse(row.fulfillment_snapshot_json)
      : null,
    status: row.status,
    version: row.version,
    expiresAt: row.expires_at,
  };
}

export function createCheckoutRepository(database: D1Database) {
  return {
    async findQuoteByIdempotencyKey(key: string): Promise<CheckoutQuoteRow | null> {
      const row = await database
        .prepare(`SELECT ${COLUMNS} FROM checkout_quote WHERE idempotency_key=?`)
        .bind(key)
        .first<RawRow>();
      return row ? map(row) : null;
    },
    async findQuoteById(id: string): Promise<CheckoutQuoteRow | null> {
      const row = await database
        .prepare(`SELECT ${COLUMNS} FROM checkout_quote WHERE id=?`)
        .bind(id)
        .first<RawRow>();
      return row ? map(row) : null;
    },
    insertQuote(
      input: CheckoutQuoteRow & { idempotencyKey: string },
      now: number,
    ): D1PreparedStatement {
      return database
        .prepare(
          "INSERT INTO checkout_quote (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, fulfillment_mode, currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json, address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version, expires_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.id,
          input.attemptId,
          input.customerId,
          input.cartId,
          input.addressId,
          input.deliveryCycleId,
          input.fulfillmentMode ?? "SCHEDULED",
          input.currency,
          input.subtotalMinor,
          input.discountMinor,
          input.deliveryFeeMinor,
          input.totalMinor,
          JSON.stringify(input.lines),
          JSON.stringify(input.addressSnapshot ?? null),
          JSON.stringify(input.cycleSnapshot ?? null),
          JSON.stringify(input.fulfillmentSnapshot ?? null),
          input.status,
          input.version,
          input.expiresAt,
          input.idempotencyKey,
          now,
          now,
        );
    },
    supersedeQuotesForCart(
      cartId: string,
      exceptQuoteId: string,
      now: number,
    ): D1PreparedStatement {
      return database
        .prepare(
          "UPDATE checkout_quote SET status='SUPERSEDED', updated_at=? WHERE cart_id=? AND id!=? AND status='ACTIVE'",
        )
        .bind(now, cartId, exceptQuoteId);
    },
  };
}

export type CheckoutRepository = ReturnType<typeof createCheckoutRepository>;
