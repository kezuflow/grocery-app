import type {
  AppErrorCode,
  OrderFeedbackView,
  PopularWithCartProductView,
  RpcResult,
  SavedProductView,
} from "@freshmarkets/contracts";

const failure = <T>(code: AppErrorCode, message: string, requestId: string): RpcResult<T> => ({
  ok: false,
  error: { code, message, requestId },
});

export async function listSavedProducts(
  database: D1Database,
  customerId: string,
  requestId: string,
): Promise<RpcResult<readonly SavedProductView[]>> {
  const rows = await database
    .prepare(`
    SELECT s.product_id productId,p.slug,p.name,s.created_at savedAt
    FROM customer_saved_product s JOIN product p ON p.id=s.product_id AND p.status='active'
    WHERE s.customer_id=? ORDER BY s.created_at DESC,s.product_id
  `)
    .bind(customerId)
    .all<{ productId: string; slug: string; name: string; savedAt: number }>();
  return {
    ok: true,
    value: rows.results.map((row) => ({
      productId: row.productId,
      slug: row.slug,
      name: row.name,
      savedAt: new Date(row.savedAt).toISOString(),
    })),
    requestId,
  };
}

export async function listPopularWithCart(
  database: D1Database,
  customerId: string,
  requestId: string,
): Promise<RpcResult<readonly PopularWithCartProductView[]>> {
  const rows = await database
    .prepare(`
    WITH cart_context AS (
      SELECT id,location_id FROM cart WHERE customer_id=? AND status='ACTIVE' LIMIT 1
    ), chosen AS (
      SELECT DISTINCT s.product_id FROM cart_context c JOIN cart_item item ON item.cart_id=c.id
      JOIN sku s ON s.id=item.sku_id
    ), related_orders AS (
      SELECT DISTINCT line.order_id,o.created_at FROM order_item line
      JOIN sku s ON s.id=line.sku_id JOIN chosen ON chosen.product_id=s.product_id
      JOIN grocery_order o ON o.id=line.order_id
      JOIN order_payment_reaction paid ON paid.order_id=o.id
      ORDER BY o.created_at DESC LIMIT 500
    )
    SELECT p.id productId,p.slug,p.name FROM related_orders matched
    JOIN order_item line ON line.order_id=matched.order_id JOIN sku s ON s.id=line.sku_id
    JOIN product p ON p.id=s.product_id AND p.status='active'
    JOIN grocery_order o ON o.id=matched.order_id
    WHERE p.id NOT IN (SELECT product_id FROM chosen)
      AND EXISTS (
        SELECT 1 FROM sku offered
        JOIN sku_location_availability availability ON availability.sku_id=offered.id
        JOIN cart_context c ON c.location_id=availability.location_id
        WHERE offered.product_id=p.id AND availability.availability_status='AVAILABLE'
      )
    GROUP BY p.id,p.slug,p.name
    HAVING COUNT(DISTINCT matched.order_id)>=2 AND COUNT(DISTINCT o.customer_id)>=2
    ORDER BY COUNT(DISTINCT matched.order_id) DESC,p.id LIMIT 8
  `)
    .bind(customerId)
    .all<PopularWithCartProductView>();
  return { ok: true, value: rows.results, requestId };
}

export async function setSavedProduct(
  database: D1Database,
  input: { customerId: string; productId: string; saved: boolean; requestId: string },
): Promise<RpcResult<{ saved: boolean }>> {
  if (!input.saved) {
    await database
      .prepare("DELETE FROM customer_saved_product WHERE customer_id=? AND product_id=?")
      .bind(input.customerId, input.productId)
      .run();
    return { ok: true, value: { saved: false }, requestId: input.requestId };
  }
  const product = await database
    .prepare("SELECT id FROM product WHERE id=? AND status='active'")
    .bind(input.productId)
    .first<{ id: string }>();
  if (!product) return failure("NOT_FOUND", "Product is not available", input.requestId);
  await database
    .prepare(`
    INSERT OR IGNORE INTO customer_saved_product(customer_id,product_id,created_at)
    SELECT ?,p.id,? FROM product p WHERE p.id=? AND p.status='active'
  `)
    .bind(input.customerId, Date.now(), input.productId)
    .run();
  const saved = await database
    .prepare("SELECT 1 present FROM customer_saved_product WHERE customer_id=? AND product_id=?")
    .bind(input.customerId, input.productId)
    .first<{ present: number }>();
  return saved
    ? { ok: true, value: { saved: true }, requestId: input.requestId }
    : failure("CONFLICT", "Product is no longer available", input.requestId);
}

type FeedbackRow = { orderId: string; rating: number; comment: string | null; submittedAt: number };

function feedbackView(row: FeedbackRow): OrderFeedbackView {
  return {
    orderId: row.orderId,
    rating: row.rating as OrderFeedbackView["rating"],
    comment: row.comment,
    submittedAt: new Date(row.submittedAt).toISOString(),
  };
}

async function ownedOrderFeedback(
  database: D1Database,
  orderId: string,
  customerId: string,
): Promise<FeedbackRow | null> {
  return database
    .prepare(`
    SELECT f.order_id orderId,f.rating,f.comment,f.submitted_at submittedAt
    FROM customer_order_feedback f JOIN grocery_order o ON o.id=f.order_id
    WHERE f.order_id=? AND f.customer_id=? AND o.customer_id=?
  `)
    .bind(orderId, customerId, customerId)
    .first<FeedbackRow>();
}

export async function getOrderFeedback(
  database: D1Database,
  input: { orderId: string; customerId: string; requestId: string },
): Promise<RpcResult<OrderFeedbackView | null>> {
  const order = await database
    .prepare("SELECT id FROM grocery_order WHERE id=? AND customer_id=?")
    .bind(input.orderId, input.customerId)
    .first<{ id: string }>();
  if (!order) return failure("NOT_FOUND", "Order not found", input.requestId);
  const row = await ownedOrderFeedback(database, input.orderId, input.customerId);
  return { ok: true, value: row ? feedbackView(row) : null, requestId: input.requestId };
}

export async function submitOrderFeedback(
  database: D1Database,
  input: {
    orderId: string;
    customerId: string;
    rating: OrderFeedbackView["rating"];
    comment: string | null;
    requestId: string;
  },
): Promise<RpcResult<OrderFeedbackView>> {
  const comment = input.comment?.trim() || null;
  if (
    !Number.isInteger(input.rating) ||
    input.rating < 1 ||
    input.rating > 5 ||
    (comment && comment.length > 1000)
  )
    return failure("VALIDATION_FAILED", "Invalid order feedback", input.requestId);
  const order = await database
    .prepare("SELECT status FROM grocery_order WHERE id=? AND customer_id=?")
    .bind(input.orderId, input.customerId)
    .first<{ status: string }>();
  if (!order) return failure("NOT_FOUND", "Order not found", input.requestId);
  const existing = await ownedOrderFeedback(database, input.orderId, input.customerId);
  if (existing)
    return existing.rating === input.rating && existing.comment === comment
      ? { ok: true, value: feedbackView(existing), requestId: input.requestId }
      : failure("CONFLICT", "Feedback has already been submitted", input.requestId);
  if (order.status !== "DELIVERED")
    return failure("CONFLICT", "Feedback is available after delivery", input.requestId);
  await database
    .prepare(`
    INSERT OR IGNORE INTO customer_order_feedback(order_id,customer_id,rating,comment,submitted_at)
    SELECT o.id,o.customer_id,?,?,? FROM grocery_order o
    JOIN delivery_job d ON d.order_id=o.id
    WHERE o.id=? AND o.customer_id=? AND o.status='DELIVERED' AND d.status='DELIVERED'
  `)
    .bind(input.rating, comment, Date.now(), input.orderId, input.customerId)
    .run();
  const saved = await ownedOrderFeedback(database, input.orderId, input.customerId);
  if (!saved) return failure("CONFLICT", "Delivery is not complete", input.requestId);
  return saved.rating === input.rating && saved.comment === comment
    ? { ok: true, value: feedbackView(saved), requestId: input.requestId }
    : failure("CONFLICT", "Feedback has already been submitted", input.requestId);
}
