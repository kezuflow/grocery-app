import type { AdminPromotionProductTargetInput } from "@freshmarkets/contracts";
import { z, identifierSchema } from "@freshmarkets/validation";
import { calculatePromotionDiscount, isPromotionBenefitValid } from "../domain/checkout-promotion";
import type { CatalogVariant } from "@freshmarkets/contracts";

const saleSnapshotSchema = z.object({
  kind: z.literal("PRODUCT_SALE"),
  locationId: identifierSchema,
  fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
  lines: z
    .array(
      z.object({
        skuId: identifierSchema,
        quantity: z.number().int().safe().positive(),
        amountMinor: z.number().int().safe().positive(),
      }),
    )
    .min(1)
    .max(100),
});
export function parseProductSaleSnapshot(raw: string) {
  try {
    const parsed = saleSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const productSaleTargetsJsonSql = `(SELECT json_group_array(json_object('skuId',target.sku_id,'locationId',target.location_id,
  'quantityLimit',target.quantity_limit,'remainingQuantity',target.remaining_quantity,
  'productName',product.name,'skuName',sku.name,'locationName',location.name)) FROM promotion_product_target target
  JOIN sku ON sku.id=target.sku_id JOIN product ON product.id=sku.product_id
  JOIN fulfillment_location location ON location.id=target.location_id
  WHERE target.promotion_id=promotion.id)`;

/** Existing quote claims reserve sale units only while their physical hold is
 * held. Expiry/abandonment uses the existing hold release, with no second job. */
export const heldProductSaleQuantitySql = `COALESCE((
  SELECT SUM(json_extract(line.value,'$.quantity')) FROM checkout_promotion_claim claim
  JOIN checkout_quote quote ON quote.id=claim.checkout_quote_id
  JOIN json_each(claim.snapshot_json,'$.lines') line
  WHERE claim.promotion_id=target.promotion_id AND claim.status='UNCOMMITTED'
    AND json_extract(claim.snapshot_json,'$.kind')='PRODUCT_SALE'
    AND json_extract(line.value,'$.skuId')=target.sku_id
    AND (? IS NULL OR claim.checkout_quote_id!=?) AND (? IS NULL OR quote.cart_id!=?)
    AND EXISTS (SELECT 1 FROM checkout_inventory_holds hold
      JOIN sku sale_sku ON sale_sku.id=target.sku_id JOIN product sale_product ON sale_product.id=sale_sku.product_id
      WHERE hold.checkout_attempt_id=claim.checkout_quote_id AND hold.location_id=target.location_id
        AND hold.inventory_pool_id=COALESCE(sale_sku.stock_pool_id,sale_product.inventory_pool_id) AND hold.status='HELD')
),0)`;

export type ProductSaleTarget = {
  promotionId: string;
  skuId: string;
  locationId: string;
  quantityLimit: number | null;
  remainingQuantity: number | null;
};

export async function readProductSaleTargets(
  db: D1Database,
  promotionIds: readonly string[],
  exclude: { quoteId?: string; cartId?: string } = {},
): Promise<ProductSaleTarget[]> {
  if (!promotionIds.length) return [];
  const rows = await db
    .prepare(`SELECT target.promotion_id promotionId,target.sku_id skuId,target.location_id locationId,
    target.quantity_limit quantityLimit, CASE WHEN target.remaining_quantity IS NULL THEN NULL
      ELSE MAX(0,target.remaining_quantity-${heldProductSaleQuantitySql}) END remainingQuantity
    FROM promotion_product_target target WHERE target.promotion_id IN (SELECT value FROM json_each(?))
    ORDER BY target.promotion_id,target.location_id,target.sku_id`)
    .bind(
      exclude.quoteId ?? null,
      exclude.quoteId ?? null,
      exclude.cartId ?? null,
      exclude.cartId ?? null,
      JSON.stringify(promotionIds),
    )
    .all<ProductSaleTarget>();
  return rows.results;
}

/** Public catalog has no customer or basket facts. Only unconditional sales
 * can be advertised as a price; customer/minimum-purchase offers remain checkout decisions. */
export type PublicProductSaleRow = {
  skuId: string;
  promotionId: string;
  name: string;
  benefitType: "ORDER_FIXED_DISCOUNT" | "ORDER_PERCENT_DISCOUNT";
  discountMinor: number | null;
  percent: number | null;
  maximumDiscountMinor: number | null;
  endsAt: number | null;
  quantityLimit: number | null;
  remainingQuantity: number | null;
};

/** A bounded product scope lets catalog batch sales with prices and stock. */
export function preparePublicProductSales(
  db: Pick<D1Database, "prepare">,
  input: {
    locationId: string;
    at: number;
    scope: { slug: string } | { productIds: readonly string[] };
  },
): D1PreparedStatement {
  return db
    .prepare(`SELECT target.sku_id skuId,p.id promotionId,p.name,p.benefit_type benefitType,p.discount_minor discountMinor,p.percent,
    p.maximum_discount_minor maximumDiscountMinor,p.ends_at endsAt,target.quantity_limit quantityLimit,
    CASE WHEN target.remaining_quantity IS NULL THEN NULL ELSE MAX(0,target.remaining_quantity-${heldProductSaleQuantitySql}) END remainingQuantity
    FROM promotion_product_target target JOIN promotion p ON p.id=target.promotion_id
    WHERE target.location_id=? AND target.sku_id IN (SELECT s.id FROM sku s JOIN product product ON product.id=s.product_id WHERE ${"slug" in input.scope ? "product.slug=?" : "product.id IN (SELECT value FROM json_each(?))"})
      AND p.status='ACTIVE' AND p.automatic=1 AND p.starts_at<=? AND (p.ends_at IS NULL OR p.ends_at>?)
      AND p.minimum_minor=0 AND p.per_customer_usage_limit IS NULL
      AND NOT EXISTS (SELECT 1 FROM promotion_rule rule WHERE rule.promotion_id=p.id)
      AND (p.global_usage_limit IS NULL OR p.global_usage_limit>(SELECT COUNT(*) FROM promotion_redemption redemption WHERE redemption.promotion_id=p.id))`)
    .bind(
      null,
      null,
      null,
      null,
      input.locationId,
      "slug" in input.scope ? input.scope.slug : JSON.stringify(input.scope.productIds),
      input.at,
      input.at,
    );
}

export function publicProductSalePrices(
  rows: readonly PublicProductSaleRow[],
  input: {
    fulfillmentMode: "INSTANT" | "SCHEDULED";
    prices: readonly { skuId: string; priceMinor: number }[];
  },
): Map<string, NonNullable<CatalogVariant["sale"]>> {
  const prices = new Map(input.prices.map((price) => [price.skuId, price.priceMinor]));
  const result = new Map<string, NonNullable<CatalogVariant["sale"]>>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.skuId)) {
      result.delete(row.skuId);
      continue;
    }
    seen.add(row.skuId);
    if (
      row.quantityLimit !== null &&
      (input.fulfillmentMode !== "INSTANT" || (row.remainingQuantity ?? 0) < 1)
    )
      continue;
    const benefit = {
      type: row.benefitType,
      discountMinor: row.discountMinor,
      percent: row.percent,
      maximumDiscountMinor: row.maximumDiscountMinor,
    };
    if (!isPromotionBenefitValid(benefit) || !benefit.type.startsWith("ORDER_")) continue;
    const regularPrice = prices.get(row.skuId);
    if (regularPrice === undefined) continue;
    const discount = calculatePromotionDiscount(
      { benefit },
      { merchandiseSubtotalMinor: regularPrice, deliverySubtotalMinor: 0 },
    ).amountMinor;
    if (discount > 0)
      result.set(row.skuId, {
        promotionId: row.promotionId,
        name: row.name,
        priceMinor: regularPrice - discount,
        remainingQuantity: row.remainingQuantity,
        endsAt: row.endsAt === null ? null : new Date(row.endsAt).toISOString(),
      });
  }
  return result;
}

const required = (db: D1Database) =>
  db.prepare("INSERT INTO commitment_abort(id) SELECT -8 WHERE changes()<>1");

/** Called within the existing draft-definition transaction, before its receipt. */
export function replaceProductSaleTargets(
  db: D1Database,
  promotionId: string,
  targets: readonly AdminPromotionProductTargetInput[],
): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM promotion_product_target WHERE promotion_id=?").bind(promotionId),
    ...targets.flatMap((target) => [
      db
        .prepare(`INSERT INTO promotion_product_target
      (promotion_id,sku_id,location_id,quantity_limit,remaining_quantity)
      SELECT ?,s.id,l.id,?,? FROM sku s JOIN product p ON p.id=s.product_id
      JOIN fulfillment_location l ON l.id=? WHERE s.id=? AND s.status='active' AND p.status='active' AND l.status='active'`)
        .bind(
          promotionId,
          target.quantityLimit,
          target.quantityLimit,
          target.locationId,
          target.skuId,
        ),
      required(db),
    ]),
  ];
}

/** Core owns overlap, not a lifecycle trigger. The same transaction also
 * rechecks active scope and caps a newly activated sale to remaining goods. */
export function activateProductSaleStatements(
  db: D1Database,
  promotionId: string,
): D1PreparedStatement[] {
  return [
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -8 WHERE EXISTS (
      SELECT 1 FROM promotion_product_target target JOIN promotion p ON p.id=target.promotion_id
      LEFT JOIN sku s ON s.id=target.sku_id AND s.status='active'
      LEFT JOIN product product ON product.id=s.product_id AND product.status='active'
      LEFT JOIN fulfillment_location location ON location.id=target.location_id AND location.status='active'
      WHERE target.promotion_id=? AND (s.id IS NULL OR product.id IS NULL OR location.id IS NULL
        OR p.benefit_type NOT IN ('ORDER_FIXED_DISCOUNT','ORDER_PERCENT_DISCOUNT') OR p.automatic!=1 OR p.maximum_discount_minor IS NOT NULL
        OR EXISTS (SELECT 1 FROM promotion_product_target other JOIN promotion competing ON competing.id=other.promotion_id
          WHERE other.sku_id=target.sku_id AND other.location_id=target.location_id AND other.promotion_id!=p.id
            AND competing.status='ACTIVE' AND p.starts_at<COALESCE(competing.ends_at,9007199254740991)
            AND competing.starts_at<COALESCE(p.ends_at,9007199254740991))))`)
      .bind(promotionId),
    ...capProductSaleAllowanceStatements(db, { promotionId }),
  ];
}

export function consumeProductSaleStatements(
  db: D1Database,
  promotionId: string,
  quoteId: string,
  sale: z.infer<typeof saleSnapshotSchema>,
): D1PreparedStatement[] {
  return sale.lines.flatMap((line) => [
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -8 WHERE NOT EXISTS (
      SELECT 1 FROM promotion_product_target target WHERE target.promotion_id=? AND target.sku_id=? AND target.location_id=?
        AND (target.remaining_quantity IS NULL OR (target.remaining_quantity-${heldProductSaleQuantitySql}>=?
          AND EXISTS (SELECT 1 FROM checkout_inventory_holds hold JOIN sku s ON s.id=target.sku_id JOIN product p ON p.id=s.product_id
            WHERE hold.checkout_attempt_id=? AND hold.location_id=target.location_id AND hold.status='HELD'
              AND hold.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id) AND hold.quantity>=?*s.consumption_base_quantity))))`)
      .bind(
        promotionId,
        line.skuId,
        sale.locationId,
        quoteId,
        quoteId,
        null,
        null,
        line.quantity,
        quoteId,
        line.quantity,
      ),
    db
      .prepare(`UPDATE promotion_product_target SET remaining_quantity=CASE WHEN remaining_quantity IS NULL THEN NULL ELSE remaining_quantity-? END,
      version=version+1 WHERE promotion_id=? AND sku_id=? AND location_id=?`)
      .bind(line.quantity, promotionId, line.skuId, sale.locationId),
    required(db),
  ]);
}

/** Runs after balance release but before reservations change from RESERVED.
 * The cancellation's existing transaction/receipt makes restoration once-only. */
export function restoreCanceledProductSaleStatements(
  db: D1Database,
  orderId: string,
): D1PreparedStatement[] {
  const quantitySql = `COALESCE((SELECT SUM(json_extract(line.value,'$.quantity'))
    FROM order_promotion_application application JOIN json_each(application.benefit_snapshot_json,'$.lines') line
    JOIN sku s ON s.id=json_extract(line.value,'$.skuId') JOIN product p ON p.id=s.product_id
    WHERE application.order_id=? AND application.promotion_id=target.promotion_id
      AND json_extract(application.benefit_snapshot_json,'$.kind')='PRODUCT_SALE' AND s.id=target.sku_id
      AND EXISTS (SELECT 1 FROM inventory_reservation reservation WHERE reservation.order_id=application.order_id
        AND reservation.status='RESERVED' AND reservation.location_id=target.location_id
        AND reservation.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id))),0)`;
  return [
    db
      .prepare(`UPDATE promotion_product_target AS target SET remaining_quantity=MIN(quantity_limit,remaining_quantity+${quantitySql},
      COALESCE((SELECT MAX(0,b.on_hand-b.reserved)/s.consumption_base_quantity FROM sku s JOIN product p ON p.id=s.product_id
        JOIN inventory_balance b ON b.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id) AND b.location_id=target.location_id
        WHERE s.id=target.sku_id),0)),version=version+1 WHERE remaining_quantity IS NOT NULL AND ${quantitySql}>0`)
      .bind(orderId, orderId),
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -8 WHERE changes()!=(
      SELECT COUNT(*) FROM promotion_product_target target WHERE remaining_quantity IS NOT NULL AND ${quantitySql}>0)`)
      .bind(orderId),
  ];
}

/** After a stock decrease/reservation, only reduce the old allowance. Receipts
 * and fresh stock never increase it; cancellation restoration is separate. */
export function capProductSaleAllowanceStatements(
  db: D1Database,
  scope: {
    promotionId?: string;
    locationId?: string;
    inventoryPoolId?: string;
  },
): D1PreparedStatement[] {
  const matches = `target.remaining_quantity IS NOT NULL
    AND EXISTS (SELECT 1 FROM promotion WHERE id=target.promotion_id AND status IN ('ACTIVE','INACTIVE'))
    AND (? IS NULL OR target.promotion_id=?) AND (? IS NULL OR target.location_id=?)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM sku s JOIN product p ON p.id=s.product_id
      WHERE s.id=target.sku_id AND COALESCE(s.stock_pool_id,p.inventory_pool_id)=?))`;
  const bindings = [
    scope.promotionId ?? null,
    scope.promotionId ?? null,
    scope.locationId ?? null,
    scope.locationId ?? null,
    scope.inventoryPoolId ?? null,
    scope.inventoryPoolId ?? null,
  ];
  return [
    db
      .prepare(`UPDATE promotion_product_target AS target SET remaining_quantity=MIN(remaining_quantity,
    COALESCE((SELECT MAX(0,b.on_hand-b.reserved)/s.consumption_base_quantity FROM sku s JOIN product p ON p.id=s.product_id
      JOIN inventory_balance b ON b.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id) AND b.location_id=target.location_id
      WHERE s.id=target.sku_id),0)),version=version+1
    WHERE ${matches}`)
      .bind(...bindings),
    db
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -8 WHERE changes()!=(SELECT COUNT(*) FROM promotion_product_target target WHERE ${matches})`,
      )
      .bind(...bindings),
  ];
}
