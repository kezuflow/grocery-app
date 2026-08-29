import {
  assertQuoteFinancialSnapshot,
  type QuoteFinancialSnapshot,
  type QuoteLine,
} from "../domain/quote";
import type { DeliveryFeeSnapshot } from "../../geography/application/quote-delivery-fee";

export type CheckoutQuoteRow = {
  id: string;
  attemptId: string;
  customerId: string;
  cartId: string;
  addressId: string;
  deliveryCycleId: string | null;
  fulfillmentMode?: "INSTANT" | "SCHEDULED";
  currency: string;
  financial: QuoteFinancialSnapshot;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  lines: QuoteLine[];
  addressSnapshot: unknown;
  cycleSnapshot: unknown;
  fulfillmentSnapshot: unknown;
  deliveryFeeSnapshot: DeliveryFeeSnapshot | null;
  status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "SUPERSEDED";
  version: number;
  expiresAt: number;
};

const COLUMNS =
  "id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, fulfillment_mode, currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, merchandise_subtotal_minor, item_discount_minor, order_discount_minor, delivery_subtotal_minor, delivery_discount_minor, service_fee_minor, tax_minor, lines_json, address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, delivery_fee_snapshot_json, status, version, expires_at";

type RawRow = {
  id: string;
  attempt_id: string;
  customer_id: string;
  cart_id: string;
  address_id: string;
  delivery_cycle_id: string | null;
  fulfillment_mode: "INSTANT" | "SCHEDULED";
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  delivery_fee_minor: number;
  total_minor: number;
  merchandise_subtotal_minor: number;
  item_discount_minor: number;
  order_discount_minor: number;
  delivery_subtotal_minor: number;
  delivery_discount_minor: number;
  service_fee_minor: number;
  tax_minor: number;
  lines_json: string;
  address_snapshot_json: string | null;
  cycle_snapshot_json: string | null;
  fulfillment_snapshot_json: string | null;
  delivery_fee_snapshot_json: string | null;
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
    fulfillmentMode: row.fulfillment_mode ?? "SCHEDULED",
    currency: row.currency,
    financial: {
      merchandiseSubtotalMinor: row.merchandise_subtotal_minor,
      itemDiscountMinor: row.item_discount_minor,
      orderDiscountMinor: row.order_discount_minor,
      deliverySubtotalMinor: row.delivery_subtotal_minor,
      deliveryDiscountMinor: row.delivery_discount_minor,
      serviceFeeMinor: row.service_fee_minor,
      taxMinor: row.tax_minor,
      totalMinor: row.total_minor,
      currency: row.currency,
    },
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
    deliveryFeeSnapshot: row.delivery_fee_snapshot_json
      ? (JSON.parse(row.delivery_fee_snapshot_json) as DeliveryFeeSnapshot)
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
      assertQuoteFinancialSnapshot(input.financial);
      if (
        input.currency !== input.financial.currency ||
        input.subtotalMinor !== input.financial.merchandiseSubtotalMinor ||
        input.discountMinor !==
          input.financial.itemDiscountMinor + input.financial.orderDiscountMinor ||
        input.deliveryFeeMinor !== input.financial.deliverySubtotalMinor ||
        input.totalMinor !== input.financial.totalMinor
      )
        throw new Error("QUOTE_FINANCIAL_COMPATIBILITY_INVALID");
      return database
        .prepare(
          `INSERT INTO checkout_quote (
            id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id,
            fulfillment_mode, currency, subtotal_minor, discount_minor,
            delivery_fee_minor, total_minor, merchandise_subtotal_minor,
            item_discount_minor, order_discount_minor, delivery_subtotal_minor,
            delivery_discount_minor, service_fee_minor, tax_minor, lines_json,
            address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json,
            delivery_fee_snapshot_json, status, version, expires_at,
            idempotency_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.financial.merchandiseSubtotalMinor,
          input.financial.itemDiscountMinor,
          input.financial.orderDiscountMinor,
          input.financial.deliverySubtotalMinor,
          input.financial.deliveryDiscountMinor,
          input.financial.serviceFeeMinor,
          input.financial.taxMinor,
          JSON.stringify(input.lines),
          JSON.stringify(input.addressSnapshot ?? null),
          JSON.stringify(input.cycleSnapshot ?? null),
          JSON.stringify(input.fulfillmentSnapshot ?? null),
          JSON.stringify(input.deliveryFeeSnapshot ?? null),
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
