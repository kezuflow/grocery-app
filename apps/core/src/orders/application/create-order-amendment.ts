import type {
  AppErrorCode,
  CustomerOrderLineSnapshot,
  OrderAmendmentDraftView,
  RpcResult,
} from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import { amendmentEligibility } from "../domain/amendment";

export type CreateOrderAmendmentCommand = {
  customerId: string;
  orderId: string;
  expectedOrderVersion: number;
  additions: ReadonlyArray<{ skuId: string; quantity: number }>;
  idempotencyKey: string;
  requestId: string;
};

function failure(code: AppErrorCode, message: string, requestId: string): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}

type AmendmentRow = {
  id: string;
  orderId: string;
  status: OrderAmendmentDraftView["status"];
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
};

const SELECT = `SELECT a.id,a.order_id AS orderId,a.status,a.version,a.currency,
 a.total_minor AS totalMinor,a.merchandise_subtotal_minor AS merchandiseSubtotalMinor,
 a.item_discount_minor AS itemDiscountMinor,a.order_discount_minor AS orderDiscountMinor,
 a.delivery_subtotal_minor AS deliverySubtotalMinor,a.delivery_discount_minor AS deliveryDiscountMinor,
 a.service_fee_minor AS serviceFeeMinor,a.tax_minor AS taxMinor
 FROM paid_order_amendment a JOIN grocery_order o ON o.id=a.order_id
 WHERE a.idempotency_key=? AND o.customer_id=?`;

async function toView(database: D1Database, row: AmendmentRow): Promise<OrderAmendmentDraftView> {
  const lines = await database
    .prepare(
      `SELECT id AS orderItemId,sku_id AS skuId,product_name_snapshot AS productName,
       variant_name_snapshot AS variantName,unit_snapshot AS unit,quantity,
       base_quantity AS baseQuantity,unit_price_minor AS unitPriceMinor,line_total_minor AS lineTotalMinor
       FROM paid_order_amendment_line WHERE amendment_id=? ORDER BY created_at,id`,
    )
    .bind(row.id)
    .all<CustomerOrderLineSnapshot>();
  return {
    amendmentId: row.id,
    orderId: row.orderId,
    status: row.status,
    version: row.version,
    financial: {
      source: "AMENDMENT_QUOTE",
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
    },
    lines: lines.results,
  };
}

export async function createOrderAmendment(
  database: D1Database,
  command: CreateOrderAmendmentCommand,
): Promise<RpcResult<OrderAmendmentDraftView>> {
  const additions = command.additions.map((line) => ({ ...line, skuId: line.skuId.trim() }));
  const hash = await requestHash({
    customerId: command.customerId,
    orderId: command.orderId,
    expectedOrderVersion: command.expectedOrderVersion,
    additions,
  });
  const prior = await database
    .prepare(
      "SELECT request_hash,status FROM idempotency_records WHERE scope='orders.createAmendment' AND idempotency_key=?",
    )
    .bind(command.idempotencyKey)
    .first<{ request_hash: string; status: string }>();
  if (prior) {
    if (prior.request_hash !== hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", command.requestId);
    const replay = await database
      .prepare(SELECT)
      .bind(command.idempotencyKey, command.customerId)
      .first<AmendmentRow>();
    return replay
      ? { ok: true, value: await toView(database, replay), requestId: command.requestId }
      : failure("CONFLICT", "Amendment creation is still processing", command.requestId);
  }
  if (
    additions.length === 0 ||
    additions.length > 50 ||
    additions.some(
      (line) => !line.skuId || !Number.isInteger(line.quantity) || line.quantity <= 0,
    ) ||
    new Set(additions.map((line) => line.skuId)).size !== additions.length
  )
    return failure(
      "VALIDATION_FAILED",
      "Provide 1 to 50 unique additive SKU quantities",
      command.requestId,
    );

  const order = await database
    .prepare(
      `SELECT o.status,o.version,o.currency,o.fulfillment_mode,f.cycle_id,f.location_id,f.zone_id,f.cutoff_at
       FROM grocery_order o LEFT JOIN order_fulfillment_snapshot f ON f.order_id=o.id
       WHERE o.id=? AND o.customer_id=?`,
    )
    .bind(command.orderId, command.customerId)
    .first<{
      status: string;
      version: number;
      currency: string;
      fulfillment_mode: string;
      cycle_id: string | null;
      location_id: string | null;
      zone_id: string | null;
      cutoff_at: number | null;
    }>();
  if (!order) return failure("NOT_FOUND", "Order not found", command.requestId);
  if (!amendmentEligibility(order.status).eligible)
    return failure(
      "ILLEGAL_TRANSITION",
      `Order ${order.status} cannot be amended`,
      command.requestId,
    );
  if (order.fulfillment_mode !== "SCHEDULED")
    return failure(
      "ILLEGAL_TRANSITION",
      "Instant-order additions are unavailable",
      command.requestId,
    );
  if (order.version !== command.expectedOrderVersion)
    return failure("STALE_VERSION", "Order changed; refresh before retrying", command.requestId);
  if (
    !order.cycle_id ||
    !order.location_id ||
    !order.zone_id ||
    (order.cutoff_at ?? 0) <= Date.now()
  )
    return failure("CYCLE_CLOSED", "The amendment window has closed", command.requestId);
  if (
    await database
      .prepare(
        "SELECT 1 AS found FROM paid_order_amendment WHERE order_id=? AND status IN ('DRAFT','PENDING_PAYMENT') LIMIT 1",
      )
      .bind(command.orderId)
      .first()
  )
    return failure("CONFLICT", "Complete or cancel the active amendment first", command.requestId);

  const now = Date.now();
  const lines: Array<CustomerOrderLineSnapshot & { id: string }> = [];
  for (const addition of additions) {
    const sku = await database
      .prepare(
        `SELECT s.name variantName,s.sellable_unit_id unit,s.consumption_base_quantity consumption,
                p.name productName
         FROM sku s JOIN product p ON p.id=s.product_id
         JOIN location_product_availability lpa ON lpa.product_id=p.id AND lpa.location_id=?
         WHERE s.id=? AND s.status='active' AND p.status='active' AND lpa.availability_status='AVAILABLE'`,
      )
      .bind(order.location_id, addition.skuId)
      .first<{ variantName: string; unit: string; consumption: number; productName: string }>();
    if (!sku)
      return failure("UNAVAILABLE_ITEM", `SKU ${addition.skuId} is unavailable`, command.requestId);
    const price = await database
      .prepare(
        `SELECT amount_minor FROM price_version pv JOIN fulfillment_location fl ON fl.id=?
         WHERE pv.sku_id=? AND pv.market_id=fl.market_id AND pv.currency=? AND pv.price_type='STANDARD'
           AND (pv.location_id IS NULL OR pv.location_id=fl.id)
           AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
         ORDER BY (pv.location_id IS NOT NULL) DESC,pv.version DESC LIMIT 1`,
      )
      .bind(order.location_id, addition.skuId, order.currency, now, now)
      .first<{ amount_minor: number }>();
    if (!price)
      return failure(
        "PRICE_UNAVAILABLE",
        `Price unavailable for ${addition.skuId}`,
        command.requestId,
      );
    lines.push({
      id: crypto.randomUUID(),
      orderItemId: "",
      skuId: addition.skuId,
      productName: sku.productName,
      variantName: sku.variantName,
      unit: sku.unit,
      quantity: addition.quantity,
      baseQuantity: addition.quantity * sku.consumption,
      unitPriceMinor: price.amount_minor,
      lineTotalMinor: addition.quantity * price.amount_minor,
    });
  }
  const totalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const amendmentId = crypto.randomUUID();
  try {
    await database.batch([
      database
        .prepare(
          "INSERT INTO idempotency_records (scope,idempotency_key,request_hash,result_type,result_reference,status,created_at,updated_at) VALUES ('orders.createAmendment',?,?,'paid_order_amendment',?,'PROCESSING',?,?)",
        )
        .bind(command.idempotencyKey, hash, amendmentId, now, now),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -9 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND customer_id=? AND version=?)",
        )
        .bind(command.orderId, command.customerId, command.expectedOrderVersion),
      database
        .prepare(
          `INSERT INTO paid_order_amendment
           (id,order_id,status,currency,total_minor,merchandise_subtotal_minor,idempotency_key,created_at,updated_at)
           VALUES (?,?,'PENDING_PAYMENT',?,?,?,?,?,?)`,
        )
        .bind(
          amendmentId,
          command.orderId,
          order.currency,
          totalMinor,
          totalMinor,
          command.idempotencyKey,
          now,
          now,
        ),
      ...lines.map((line) =>
        database
          .prepare(
            `INSERT INTO paid_order_amendment_line
             (id,amendment_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,
              base_quantity,unit_price_minor,line_total_minor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            line.id,
            amendmentId,
            line.skuId,
            line.productName,
            line.variantName,
            line.unit,
            line.quantity,
            line.baseQuantity,
            line.unitPriceMinor,
            line.lineTotalMinor,
            now,
          ),
      ),
      database
        .prepare("UPDATE grocery_order SET version=version+1 WHERE id=? AND version=?")
        .bind(command.orderId, command.expectedOrderVersion),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',updated_at=? WHERE scope='orders.createAmendment' AND idempotency_key=? AND request_hash=?",
        )
        .bind(now, command.idempotencyKey, hash),
    ]);
  } catch {
    return failure("CONFLICT", "The order changed while creating the amendment", command.requestId);
  }
  const stored = await database
    .prepare(SELECT)
    .bind(command.idempotencyKey, command.customerId)
    .first<AmendmentRow>();
  return stored
    ? { ok: true, value: await toView(database, stored), requestId: command.requestId }
    : failure("INTERNAL_ERROR", "Amendment persistence failed", command.requestId);
}
