import type {
  AppErrorCode,
  GuestCartMerge,
  MergeGuestCartRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

const SCOPE = "cart.mergeGuest";

/** Carry quantities only; current names, prices and unavailable states come from Cart reads. */
export async function mergeGuestCart(
  database: D1Database,
  input: MergeGuestCartRequest & { customerId: string },
): Promise<RpcResult<GuestCartMerge>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<GuestCartMerge> => ({
    ok: false,
    error: { code, message, requestId: input.requestId },
  });
  const items = [...input.items].sort((a, b) => a.skuId.localeCompare(b.skuId));
  if (
    !items.length ||
    items.length > 100 ||
    new Set(items.map((item) => item.skuId)).size !== items.length ||
    items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
  )
    return fail(
      "VALIDATION_FAILED",
      "Guest cart items must have distinct selling options and positive whole quantities.",
    );
  const hash = await requestHash({
    customerId: input.customerId,
    cartId: input.cartId,
    expectedVersion: input.expectedVersion,
    items,
  });
  const existing = await findIdempotencyRecord(database, SCOPE, input.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to a different cart merge.");
    if (existing.status !== "SUCCEEDED" || !existing.resultReference)
      return fail("CONFLICT", "Your cart merge is still processing.");
    return {
      ok: true,
      value: JSON.parse(existing.resultReference) as GuestCartMerge,
      requestId: input.requestId,
    };
  }
  const cart = await database
    .prepare("SELECT version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
    .bind(input.cartId, input.customerId)
    .first<{ version: number }>();
  if (!cart) return fail("NOT_FOUND", "Active cart not found.");
  if (cart.version !== input.expectedVersion)
    return fail(
      "CART_VERSION_CONFLICT",
      "Your cart changed. Review it before carrying over guest items.",
    );
  const skus = await database
    .prepare(
      `SELECT s.id,COALESCE(ci.quantity,0) quantity FROM sku s LEFT JOIN cart_item ci ON ci.sku_id=s.id AND ci.cart_id=? WHERE s.id IN (${items.map(() => "?").join(",")})`,
    )
    .bind(input.cartId, ...items.map((item) => item.skuId))
    .all<{ id: string; quantity: number }>();
  if (skus.results.length !== items.length)
    return fail(
      "NOT_FOUND",
      "A saved guest item no longer exists. Your guest cart has been kept for review.",
    );
  if (
    items.some(
      (item) =>
        !Number.isSafeInteger(
          item.quantity + skus.results.find((sku) => sku.id === item.skuId)!.quantity,
        ),
    )
  )
    return fail("VALIDATION_FAILED", "A combined quantity exceeds the supported range.");
  const now = Date.now();
  const value = { cartId: input.cartId, version: input.expectedVersion + 1 };
  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,'cart_merge','PROCESSING',?,?)",
        )
        .bind(SCOPE, input.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -6 WHERE NOT EXISTS (SELECT 1 FROM customer c WHERE c.id=? AND c.status='active' AND NOT EXISTS (SELECT 1 FROM customer_principal principal WHERE principal.auth_user_id=c.auth_user_id AND principal.status!='active'))",
        )
        .bind(input.customerId),
      ...items.flatMap((item) => [
        database
          .prepare(`INSERT INTO cart_item(cart_id,sku_id,quantity) VALUES (?,?,?)
          ON CONFLICT(cart_id,sku_id) DO UPDATE SET quantity=cart_item.quantity+excluded.quantity
          WHERE cart_item.quantity<=?`)
          .bind(input.cartId, item.skuId, item.quantity, Number.MAX_SAFE_INTEGER - item.quantity),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
      ]),
      database
        .prepare(
          "UPDATE cart SET version=version+1,updated_at=? WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?",
        )
        .bind(now, input.cartId, input.customerId, input.expectedVersion),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(value), now, SCOPE, input.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
    ]);
  } catch (error) {
    const raced = await findIdempotencyRecord(database, SCOPE, input.idempotencyKey);
    if (raced?.requestHash === hash && raced.status === "SUCCEEDED" && raced.resultReference)
      return {
        ok: true,
        value: JSON.parse(raced.resultReference) as GuestCartMerge,
        requestId: input.requestId,
      };
    if (raced && raced.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to a different cart merge.");
    const latest = await database
      .prepare("SELECT version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
      .bind(input.cartId, input.customerId)
      .first<{ version: number }>();
    if (!latest || latest.version !== input.expectedVersion)
      return fail(
        "CART_VERSION_CONFLICT",
        "Your cart changed. Guest items have been kept for retry.",
      );
    throw error;
  }
  return { ok: true, value, requestId: input.requestId };
}
