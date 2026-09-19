import type {
  AppErrorCode,
  ClearCartRequest,
  ClearCartResult,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  CHECKOUT_PAYMENT_IN_PROGRESS_REASON,
  cartHasUnsettledCheckout,
  cartMutationPaymentGuard,
  releaseUncommittedCheckoutStatements,
} from "./release-uncommitted-checkout";

const SCOPE = "cart.clear";
const receiptSchema = z.object({
  cartId: z.string(),
  outcome: z.enum(["CLEARED", "ALREADY_EMPTY"]),
  clearedLineCount: z.number().int().nonnegative(),
  releasedCheckoutAttempts: z.number().int().nonnegative(),
  newCartVersion: z.number().int().positive(),
});

type Command = ClearCartRequest & { customerId: string };

function failure(
  command: Command,
  code: AppErrorCode,
  message: string,
  details?: Readonly<Record<string, string>>,
): RpcResult<never> {
  return { ok: false, error: { code, message, requestId: command.requestId, details } };
}

async function replay(
  database: D1Database,
  command: Command,
  hash: string,
): Promise<RpcResult<ClearCartResult> | null> {
  const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
  if (!saved) return null;
  if (saved.requestHash !== hash)
    return failure(
      command,
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for another clear-cart command.",
    );
  if (saved.status !== "SUCCEEDED" || !saved.resultReference)
    return failure(command, "CONFLICT", "The clear-cart command is still being processed.");
  const parsed = receiptSchema.safeParse(JSON.parse(saved.resultReference));
  return parsed.success
    ? { ok: true, value: parsed.data, requestId: command.requestId }
    : failure(command, "INTERNAL_ERROR", "The saved clear-cart result could not be recovered.");
}

/** Clear one owned active Cart and release its unpaid checkout attempts atomically. */
export async function clearCart(
  database: D1Database,
  command: Command,
): Promise<RpcResult<ClearCartResult>> {
  const hash = await requestHash({
    customerId: command.customerId,
    cartId: command.cartId,
    expectedVersion: command.expectedVersion,
  });
  const saved = await replay(database, command, hash);
  if (saved) return saved;

  const cart = await database
    .prepare(
      "SELECT id,location_id,version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'",
    )
    .bind(command.cartId, command.customerId)
    .first<{ id: string; location_id: string; version: number }>();
  if (!cart) return failure(command, "NOT_FOUND", "Active cart not found.");
  if (await cartHasUnsettledCheckout(database, cart.id))
    return failure(
      command,
      "CONFLICT",
      "This cart is locked while its payment is being confirmed.",
      {
        reason: CHECKOUT_PAYMENT_IN_PROGRESS_REASON,
      },
    );
  if (cart.version !== command.expectedVersion)
    return failure(
      command,
      "CART_VERSION_CONFLICT",
      "The cart changed; reload it before clearing.",
    );

  const lines = await database
    .prepare("SELECT COUNT(*) count FROM cart_item WHERE cart_id=?")
    .bind(cart.id)
    .first<{ count: number }>();
  const releasable = await database
    .prepare(
      `SELECT quote.id FROM checkout_quote quote
       LEFT JOIN checkout_attempts attempt ON attempt.id=quote.attempt_id
       WHERE quote.cart_id=? AND quote.customer_id=?
         AND (quote.status='ACTIVE' OR attempt.status='PROCESSING')
       ORDER BY quote.id`,
    )
    .bind(cart.id, command.customerId)
    .all<{ id: string }>();
  const clearedLineCount = lines?.count ?? 0;
  const result: ClearCartResult = {
    cartId: cart.id,
    outcome: clearedLineCount > 0 ? "CLEARED" : "ALREADY_EMPTY",
    clearedLineCount,
    releasedCheckoutAttempts: releasable.results.length,
    newCartVersion: cart.version + (clearedLineCount > 0 ? 1 : 0),
  };
  const now = Date.now();
  const releaseIds = releasable.results.map((quote) => quote.id);
  const releasePlaceholders = releaseIds.map(() => "?").join(",");
  const releaseSetGuard = releaseIds.length
    ? database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE
             (SELECT COUNT(*) FROM checkout_quote quote
              LEFT JOIN checkout_attempts attempt ON attempt.id=quote.attempt_id
              WHERE quote.cart_id=? AND quote.customer_id=?
                AND (quote.status='ACTIVE' OR attempt.status='PROCESSING'))!=?
             OR EXISTS (
               SELECT 1 FROM checkout_quote quote
               LEFT JOIN checkout_attempts attempt ON attempt.id=quote.attempt_id
               WHERE quote.cart_id=? AND quote.customer_id=?
                 AND (quote.status='ACTIVE' OR attempt.status='PROCESSING')
                 AND quote.id NOT IN (${releasePlaceholders})
             )`,
        )
        .bind(
          cart.id,
          command.customerId,
          releaseIds.length,
          cart.id,
          command.customerId,
          ...releaseIds,
        )
    : database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (
             SELECT 1 FROM checkout_quote quote
             LEFT JOIN checkout_attempts attempt ON attempt.id=quote.attempt_id
             WHERE quote.cart_id=? AND quote.customer_id=?
               AND (quote.status='ACTIVE' OR attempt.status='PROCESSING'))`,
        )
        .bind(cart.id, command.customerId);

  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,'cart_clear','PROCESSING',?,?)",
        )
        .bind(SCOPE, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (
             SELECT 1 FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
           ) OR (SELECT COUNT(*) FROM cart_item WHERE cart_id=?)!=?`,
        )
        .bind(cart.id, command.customerId, cart.version, cart.id, clearedLineCount),
      cartMutationPaymentGuard(database, cart.id),
      releaseSetGuard,
      ...releaseIds.flatMap((quoteId) =>
        releaseUncommittedCheckoutStatements(database, {
          quoteId,
          paymentIntentId: null,
          customerId: command.customerId,
          now,
          attemptStatus: "EXPIRED",
        }),
      ),
      ...(clearedLineCount > 0
        ? [
            database
              .prepare(
                `DELETE FROM cart_item WHERE cart_id=? AND EXISTS (
                   SELECT 1 FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
                 ) AND EXISTS (
                   SELECT 1 FROM idempotency_records
                   WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'
                 )`,
              )
              .bind(
                cart.id,
                cart.id,
                command.customerId,
                cart.version,
                SCOPE,
                command.idempotencyKey,
                hash,
              ),
            database
              .prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=?")
              .bind(clearedLineCount),
            database
              .prepare(
                "UPDATE cart SET version=version+1,updated_at=? WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?",
              )
              .bind(now, cart.id, command.customerId, cart.version),
            database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
          ]
        : []),
      ...releaseIds.flatMap((quoteId) => [
        auditEventStatement(database, {
          actorUserId: null,
          action: "CHECKOUT.SUPERSEDED_BY_CART_CLEAR",
          resourceType: "checkout_quote",
          resourceId: quoteId,
          correlationId: command.requestId,
          idempotencyKey: `${command.idempotencyKey}:quote:${quoteId}`,
          occurredAt: now,
          details: { cartId: cart.id },
        }),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      ]),
      auditEventStatement(database, {
        actorUserId: null,
        action: "CART.CLEARED",
        resourceType: "cart",
        resourceId: cart.id,
        correlationId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        occurredAt: now,
        locationId: cart.location_id,
        details: result,
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    ]);
  } catch {
    const raced = await replay(database, command, hash);
    if (raced) return raced;
    if (await cartHasUnsettledCheckout(database, cart.id))
      return failure(
        command,
        "CONFLICT",
        "This cart is locked while its payment is being confirmed.",
        { reason: CHECKOUT_PAYMENT_IN_PROGRESS_REASON },
      );
    const latest = await database
      .prepare("SELECT version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
      .bind(cart.id, command.customerId)
      .first<{ version: number }>();
    if (!latest) return failure(command, "NOT_FOUND", "Active cart not found.");
    if (latest.version !== command.expectedVersion)
      return failure(
        command,
        "CART_VERSION_CONFLICT",
        "The cart changed; reload it before clearing.",
      );
    return failure(command, "INTERNAL_ERROR", "The cart could not be cleared.");
  }
  return { ok: true, value: result, requestId: command.requestId };
}
