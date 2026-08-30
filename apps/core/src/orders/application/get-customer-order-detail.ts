import type {
  CustomerOrderActionView,
  CustomerOrderDetailView,
  CustomerOrderFinancialView,
  CustomerOrderLineSnapshot,
  DeliveryJobState,
  FulfillmentState,
  ImplementedOrderState,
  OrderIssueCategory,
  OrderIssueStatus,
  PaymentState,
  RefundState,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  buildCustomerOrderTimeline,
  type CustomerTimelineFact,
} from "./build-customer-order-timeline";

type DetailQuery = { customerId: string; orderId: string; requestId: string };

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function safeAddress(snapshotJson: string): CustomerOrderDetailView["fulfillment"]["address"] {
  const snapshot = parseObject(snapshotJson);
  const components = parseObject(snapshot.address_json ?? snapshot.components);
  const instructions = parseObject(snapshot.delivery_instructions_json ?? snapshot.instructions);
  return {
    label: stringOrNull(snapshot.label),
    recipient: stringOrNull(snapshot.recipient),
    phone: stringOrNull(snapshot.phone),
    addressLine1: stringOrNull(components.addressLine1 ?? snapshot.addressLine1),
    addressLine2: stringOrNull(components.addressLine2 ?? snapshot.addressLine2),
    barangay: stringOrNull(components.barangay ?? snapshot.barangay),
    city: stringOrNull(components.city ?? snapshot.city),
    region: stringOrNull(components.region ?? snapshot.region),
    postalCode: stringOrNull(components.postalCode ?? snapshot.postalCode),
    countryCode: stringOrNull(components.countryCode ?? snapshot.countryCode),
    deliveryNote: stringOrNull(instructions.deliveryNote),
  };
}

function orderFinancial(row: {
  hasQuote: number;
  currency: string;
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}): CustomerOrderFinancialView {
  if (!row.hasQuote)
    return {
      source: "ORDER_TOTAL_ONLY",
      currency: row.currency,
      merchandiseSubtotalMinor: null,
      itemDiscountMinor: null,
      orderDiscountMinor: null,
      deliverySubtotalMinor: null,
      deliveryFeeMinor: null,
      deliveryDiscountMinor: null,
      serviceFeeMinor: null,
      taxMinor: null,
      totalMinor: row.totalMinor,
    };
  return {
    source: "CHECKOUT_QUOTE",
    currency: row.currency,
    merchandiseSubtotalMinor: row.merchandiseSubtotalMinor,
    itemDiscountMinor: row.itemDiscountMinor,
    orderDiscountMinor: row.orderDiscountMinor,
    deliverySubtotalMinor: row.deliverySubtotalMinor,
    deliveryFeeMinor: row.deliverySubtotalMinor - row.deliveryDiscountMinor,
    deliveryDiscountMinor: row.deliveryDiscountMinor,
    serviceFeeMinor: row.serviceFeeMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
  };
}

function actions(input: {
  mode: "INSTANT" | "SCHEDULED";
  status: string;
  cutoffAt: number | null;
  invoiceStatus: CustomerOrderDetailView["invoice"]["status"];
}): CustomerOrderActionView[] {
  const amendable =
    input.mode === "SCHEDULED" &&
    ["COMMITTED", "IN_FULFILLMENT"].includes(input.status) &&
    input.cutoffAt !== null &&
    input.cutoffAt > Date.now();
  return [
    { action: "REORDER", available: true, disabledReason: null },
    { action: "REPORT_ISSUE", available: true, disabledReason: null },
    {
      action: "REQUEST_AMENDMENT",
      available: amendable,
      disabledReason: amendable
        ? null
        : input.mode === "INSTANT"
          ? "INSTANT_AMENDMENT_POLICY_UNAVAILABLE"
          : "AMENDMENT_WINDOW_CLOSED",
    },
    {
      action: "VIEW_INVOICE",
      available: input.invoiceStatus === "ISSUED",
      disabledReason: input.invoiceStatus === "ISSUED" ? null : "INVOICE_NOT_AVAILABLE",
    },
    {
      action: "CANCEL",
      available: false,
      disabledReason: "COMMITTED_ORDER_CANCELLATION_UNAVAILABLE",
    },
  ];
}

export async function getCustomerOrderDetail(
  database: D1Database,
  query: DetailQuery,
): Promise<RpcResult<CustomerOrderDetailView>> {
  const row = await database
    .prepare(
      `SELECT o.id AS orderId, o.order_number AS orderNumber, o.status, o.version,
              COALESCE(o.committed_at,o.created_at) AS committedAt, o.currency,
              o.total_minor AS totalMinor,
              o.merchandise_subtotal_minor AS merchandiseSubtotalMinor,
              o.item_discount_minor AS itemDiscountMinor,
              o.order_discount_minor AS orderDiscountMinor,
              o.delivery_subtotal_minor AS deliverySubtotalMinor,
              o.delivery_discount_minor AS deliveryDiscountMinor,
              o.service_fee_minor AS serviceFeeMinor, o.tax_minor AS taxMinor,
              o.address_snapshot_json AS addressSnapshotJson,
              o.fulfillment_mode AS fulfillmentMode,
              ofs.cycle_id AS cycleId, ofs.cutoff_at AS cutoffAt,
              ofs.delivery_date AS deliveryDate, ofs.promised_at AS promisedAt,
              f.status AS fulfillmentStatus, f.updated_at AS fulfillmentUpdatedAt,
              d.id AS deliveryId, d.status AS deliveryStatus, d.updated_at AS deliveryUpdatedAt,
              EXISTS(SELECT 1 FROM order_payment_reaction opr
                     WHERE opr.order_id=o.id AND opr.checkout_quote_id IS NOT NULL) AS hasQuote
       FROM grocery_order o
       LEFT JOIN order_fulfillment_snapshot ofs ON ofs.order_id=o.id
       LEFT JOIN fulfillment_record f ON f.order_id=o.id
       LEFT JOIN delivery_job d ON d.order_id=o.id
       WHERE o.id=? AND o.customer_id=?`,
    )
    .bind(query.orderId, query.customerId)
    .first<{
      orderId: string;
      orderNumber: string | null;
      status: string;
      version: number;
      committedAt: number;
      currency: string;
      totalMinor: number;
      merchandiseSubtotalMinor: number;
      itemDiscountMinor: number;
      orderDiscountMinor: number;
      deliverySubtotalMinor: number;
      deliveryDiscountMinor: number;
      serviceFeeMinor: number;
      taxMinor: number;
      addressSnapshotJson: string;
      fulfillmentMode: "INSTANT" | "SCHEDULED";
      cycleId: string | null;
      cutoffAt: number | null;
      deliveryDate: number | null;
      promisedAt: number | null;
      fulfillmentStatus: string | null;
      fulfillmentUpdatedAt: number | null;
      deliveryId: string | null;
      deliveryStatus: string | null;
      deliveryUpdatedAt: number | null;
      hasQuote: number;
    }>();
  if (!row)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: query.requestId },
    };

  const [itemsResult, paymentsResult, amendmentRows, issuesResult, invoiceRow] = await Promise.all([
    database
      .prepare(
        `SELECT id AS orderItemId, sku_id AS skuId, product_name_snapshot AS productName,
                variant_name_snapshot AS variantName, unit_snapshot AS unit, quantity,
                base_quantity AS baseQuantity, unit_price_minor AS unitPriceMinor,
                line_total_minor AS lineTotalMinor
         FROM order_item WHERE order_id=? ORDER BY id`,
      )
      .bind(query.orderId)
      .all<CustomerOrderLineSnapshot>(),
    database
      .prepare(
        `SELECT DISTINCT pi.id AS paymentId, pi.purpose, pi.status,
                pi.amount_minor AS amountMinor, pi.currency,
                pi.created_at AS createdAt, pi.updated_at AS updatedAt
         FROM payment_intent pi
         WHERE pi.id IN (
           SELECT pa.payment_intent_id FROM grocery_order go
           JOIN payment_attempt pa ON pa.id=go.payment_id
           WHERE go.id=? AND pa.payment_intent_id IS NOT NULL
           UNION SELECT payment_intent_id FROM paid_order_amendment
                 WHERE order_id=? AND payment_intent_id IS NOT NULL
         ) ORDER BY pi.created_at, pi.id`,
      )
      .bind(query.orderId, query.orderId)
      .all<{
        paymentId: string;
        purpose: "GROCERY_CHECKOUT" | "ORDER_AMENDMENT";
        status: PaymentState;
        amountMinor: number;
        currency: string;
        createdAt: number;
        updatedAt: number;
      }>(),
    database
      .prepare(
        `SELECT id, status, version, currency, total_minor AS totalMinor,
                merchandise_subtotal_minor AS merchandiseSubtotalMinor,
                item_discount_minor AS itemDiscountMinor,
                order_discount_minor AS orderDiscountMinor,
                delivery_subtotal_minor AS deliverySubtotalMinor,
                delivery_discount_minor AS deliveryDiscountMinor,
                service_fee_minor AS serviceFeeMinor, tax_minor AS taxMinor,
                committed_at AS committedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM paid_order_amendment WHERE order_id=? ORDER BY created_at,id`,
      )
      .bind(query.orderId)
      .all<{
        id: string;
        status: CustomerOrderDetailView["amendments"][number]["status"];
        version: number;
        currency: string;
        totalMinor: number;
        merchandiseSubtotalMinor: number;
        itemDiscountMinor: number;
        orderDiscountMinor: number;
        deliverySubtotalMinor: number;
        deliveryDiscountMinor: number;
        serviceFeeMinor: number;
        taxMinor: number;
        committedAt: number | null;
        createdAt: number;
        updatedAt: number;
      }>(),
    database
      .prepare(
        `SELECT id AS issueId, category, status, details,
                created_at AS createdAt, updated_at AS updatedAt
         FROM order_issue WHERE order_id=? AND customer_id=? ORDER BY created_at,id`,
      )
      .bind(query.orderId, query.customerId)
      .all<{
        issueId: string;
        category: OrderIssueCategory;
        status: OrderIssueStatus;
        details: string | null;
        createdAt: number;
        updatedAt: number;
      }>(),
    database
      .prepare(
        `SELECT status, invoice_identifier AS invoiceIdentifier, issued_at AS issuedAt
         FROM order_invoice_readiness WHERE order_id=?`,
      )
      .bind(query.orderId)
      .first<{
        status: "NOT_READY" | "READY" | "ISSUED";
        invoiceIdentifier: string | null;
        issuedAt: number | null;
      }>(),
  ]);

  const amendments = await Promise.all(
    amendmentRows.results.map(async (amendment) => {
      const lines = await database
        .prepare(
          `SELECT id AS orderItemId, sku_id AS skuId, product_name_snapshot AS productName,
                  variant_name_snapshot AS variantName, unit_snapshot AS unit, quantity,
                  base_quantity AS baseQuantity, unit_price_minor AS unitPriceMinor,
                  line_total_minor AS lineTotalMinor
           FROM paid_order_amendment_line WHERE amendment_id=? ORDER BY created_at,id`,
        )
        .bind(amendment.id)
        .all<CustomerOrderLineSnapshot>();
      return {
        amendmentId: amendment.id,
        status: amendment.status,
        version: amendment.version,
        financial: {
          source: "AMENDMENT_QUOTE" as const,
          currency: amendment.currency,
          merchandiseSubtotalMinor: amendment.merchandiseSubtotalMinor,
          itemDiscountMinor: amendment.itemDiscountMinor,
          orderDiscountMinor: amendment.orderDiscountMinor,
          deliverySubtotalMinor: amendment.deliverySubtotalMinor,
          deliveryFeeMinor: amendment.deliverySubtotalMinor - amendment.deliveryDiscountMinor,
          deliveryDiscountMinor: amendment.deliveryDiscountMinor,
          serviceFeeMinor: amendment.serviceFeeMinor,
          taxMinor: amendment.taxMinor,
          totalMinor: amendment.totalMinor,
        },
        lines: lines.results,
        committedAt: iso(amendment.committedAt),
        createdAt: new Date(amendment.createdAt).toISOString(),
        updatedAt: new Date(amendment.updatedAt).toISOString(),
      };
    }),
  );
  const payments = paymentsResult.results.map((payment) => ({
    ...payment,
    createdAt: new Date(payment.createdAt).toISOString(),
    updatedAt: new Date(payment.updatedAt).toISOString(),
  }));
  const paymentIds = paymentsResult.results.map((payment) => payment.paymentId);
  const refundsResult =
    paymentIds.length === 0
      ? {
          results: [] as Array<{
            refundId: string;
            status: RefundState;
            amountMinor: number;
            currency: string;
            createdAt: number;
            updatedAt: number;
          }>,
        }
      : await database
          .prepare(
            `SELECT id AS refundId, status, amount_minor AS amountMinor, currency,
                    created_at AS createdAt, updated_at AS updatedAt
             FROM payment_refund WHERE payment_intent_id IN (${paymentIds.map(() => "?").join(",")})
             ORDER BY created_at,id`,
          )
          .bind(...paymentIds)
          .all<{
            refundId: string;
            status: RefundState;
            amountMinor: number;
            currency: string;
            createdAt: number;
            updatedAt: number;
          }>();
  const refunds = refundsResult.results.map((refund) => ({
    ...refund,
    createdAt: new Date(refund.createdAt).toISOString(),
    updatedAt: new Date(refund.updatedAt).toISOString(),
  }));
  const issues = issuesResult.results.map((issue) => ({
    ...issue,
    createdAt: new Date(issue.createdAt).toISOString(),
    updatedAt: new Date(issue.updatedAt).toISOString(),
  }));
  const invoice: CustomerOrderDetailView["invoice"] = invoiceRow
    ? {
        status: invoiceRow.status,
        invoiceIdentifier: invoiceRow.status === "ISSUED" ? invoiceRow.invoiceIdentifier : null,
        issuedAt: invoiceRow.status === "ISSUED" ? iso(invoiceRow.issuedAt) : null,
      }
    : { status: "NOT_AVAILABLE", invoiceIdentifier: null, issuedAt: null };

  const facts: CustomerTimelineFact[] = [
    { type: "ORDER_COMMITTED", id: row.orderId, status: row.status, occurredAt: row.committedAt },
    ...paymentsResult.results.map((payment) => ({
      type: "PAYMENT_STATUS" as const,
      id: payment.paymentId,
      status: payment.status,
      occurredAt: payment.updatedAt,
    })),
    ...(row.fulfillmentStatus && row.fulfillmentUpdatedAt !== null
      ? [
          {
            type: "FULFILLMENT_STATUS" as const,
            id: row.orderId,
            status: row.fulfillmentStatus,
            occurredAt: row.fulfillmentUpdatedAt,
          },
        ]
      : []),
    ...(row.deliveryId && row.deliveryStatus && row.deliveryUpdatedAt !== null
      ? [
          {
            type: "DELIVERY_STATUS" as const,
            id: row.deliveryId,
            status: row.deliveryStatus,
            occurredAt: row.deliveryUpdatedAt,
          },
        ]
      : []),
    ...amendmentRows.results.map((amendment) => ({
      type: "AMENDMENT_STATUS" as const,
      id: amendment.id,
      status: amendment.status,
      occurredAt: amendment.updatedAt,
    })),
    ...refundsResult.results.map((refund) => ({
      type: "REFUND_STATUS" as const,
      id: refund.refundId,
      status: refund.status,
      occurredAt: refund.updatedAt,
    })),
    ...issuesResult.results.map((issue) => ({
      type: "ISSUE_STATUS" as const,
      id: issue.issueId,
      status: issue.status,
      occurredAt: issue.updatedAt,
    })),
  ];

  return {
    ok: true,
    value: {
      orderId: row.orderId,
      orderNumber: row.orderNumber ?? row.orderId,
      status: row.status as ImplementedOrderState,
      version: row.version,
      committedAt: new Date(row.committedAt).toISOString(),
      financial: orderFinancial(row),
      items: itemsResult.results,
      fulfillment: {
        mode: row.fulfillmentMode,
        status: row.fulfillmentStatus as FulfillmentState | null,
        deliveryStatus: row.deliveryStatus as DeliveryJobState | null,
        cycleId: row.fulfillmentMode === "SCHEDULED" ? row.cycleId : null,
        deliveryDate: row.fulfillmentMode === "SCHEDULED" ? iso(row.deliveryDate) : null,
        promisedAt: row.fulfillmentMode === "INSTANT" ? iso(row.promisedAt) : null,
        address: safeAddress(row.addressSnapshotJson),
      },
      payments,
      refunds,
      amendments,
      issues,
      invoice,
      timeline: buildCustomerOrderTimeline(facts),
      actions: actions({
        mode: row.fulfillmentMode,
        status: row.status,
        cutoffAt: row.cutoffAt,
        invoiceStatus: invoice.status,
      }),
    },
    requestId: query.requestId,
  };
}
