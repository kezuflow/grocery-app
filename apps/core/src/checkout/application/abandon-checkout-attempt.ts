import type { AbandonCheckoutResult, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { releaseUncommittedCheckoutStatements } from "./release-uncommitted-checkout";

type Command = {
  customerId: string;
  quoteId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
};
const SCOPE = "checkout.abandon";
const receipt = z.object({
  quoteId: z.string(),
  outcome: z.enum(["ABANDONED", "ALREADY_TERMINAL"]),
  quoteStatus: z.enum(["SUPERSEDED", "EXPIRED"]),
  releasedInventoryHolds: z.number().int().nonnegative(),
});
const financialRisk = `EXISTS (SELECT 1 FROM payment_intent WHERE subject_type='checkout_quote' AND subject_id=? AND status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) OR EXISTS (SELECT 1 FROM order_payment_reaction WHERE checkout_quote_id=?)`;

export async function abandonCheckoutAttempt(
  database: D1Database,
  command: Command,
): Promise<RpcResult<AbandonCheckoutResult>> {
  const fail = (
    code: "NOT_FOUND" | "STALE_VERSION" | "CONFLICT" | "IDEMPOTENCY_CONFLICT",
    message: string,
  ): RpcResult<never> => ({ ok: false, error: { code, message, requestId: command.requestId } });
  const quote = await database
    .prepare("SELECT status,version FROM checkout_quote WHERE id=? AND customer_id=?")
    .bind(command.quoteId, command.customerId)
    .first<{ status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "SUPERSEDED"; version: number }>();
  if (!quote) return fail("NOT_FOUND", "Quote not found");
  const hash = await requestHash({
    customerId: command.customerId,
    quoteId: command.quoteId,
    expectedVersion: command.expectedVersion,
  });
  async function replay(): Promise<RpcResult<AbandonCheckoutResult> | null> {
    const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "That key belongs to a different abandonment request");
    if (saved.status === "SUCCEEDED") {
      try {
        return {
          ok: true,
          value: receipt.parse(JSON.parse(saved.resultReference ?? "null")),
          requestId: command.requestId,
        };
      } catch {
        return fail("CONFLICT", "Saved abandonment result requires review");
      }
    }
    return null;
  }
  const saved = await replay();
  if (saved) return saved;
  if (quote.status === "CONSUMED")
    return fail("CONFLICT", "A committed order cannot be canceled from checkout");
  if (quote.version !== command.expectedVersion)
    return fail("STALE_VERSION", "Quote changed; review it before retrying");
  if (
    await database
      .prepare(`SELECT 1 WHERE ${financialRisk}`)
      .bind(command.quoteId, command.quoteId)
      .first()
  )
    return fail("CONFLICT", "Payment processing has started; checkout cannot be abandoned safely");
  const holds = await database
    .prepare(
      "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
    )
    .bind(command.quoteId)
    .first<{ n: number }>();
  const result: AbandonCheckoutResult = {
    quoteId: command.quoteId,
    outcome: quote.status === "ACTIVE" ? "ABANDONED" : "ALREADY_TERMINAL",
    quoteStatus: quote.status === "EXPIRED" ? "EXPIRED" : "SUPERSEDED",
    releasedInventoryHolds: holds?.n ?? 0,
  };
  const now = Date.now();
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM checkout_quote q JOIN customer c ON c.id=q.customer_id WHERE q.id=? AND q.customer_id=? AND q.status=? AND q.version=? AND c.status='active' AND (c.principal_id IS NULL OR EXISTS (SELECT 1 FROM customer_principal principal WHERE principal.id=c.principal_id AND principal.auth_user_id=c.auth_user_id AND principal.status='active'))) OR ${financialRisk}`,
        )
        .bind(
          command.quoteId,
          command.customerId,
          quote.status,
          command.expectedVersion,
          command.quoteId,
          command.quoteId,
        ),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE (SELECT COUNT(*) FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD')!=?",
        )
        .bind(command.quoteId, result.releasedInventoryHolds),
      database
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','checkout_abandon',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.status IN ('FAILED','PROCESSING') AND idempotency_records.request_hash=excluded.request_hash",
        )
        .bind(SCOPE, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      ...releaseUncommittedCheckoutStatements(database, {
        quoteId: command.quoteId,
        customerId: command.customerId,
        paymentIntentId: null,
        now,
        attemptStatus: "EXPIRED",
      }),
      auditEventStatement(database, {
        actorUserId: null,
        action: "CHECKOUT.ABANDONED",
        resourceType: "checkout_quote",
        resourceId: command.quoteId,
        correlationId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        occurredAt: now,
        details: { customerId: command.customerId, ...result },
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    ]);
    return { ok: true, value: result, requestId: command.requestId };
  } catch {
    return (
      (await replay()) ??
      fail("CONFLICT", "Checkout changed while abandonment was applied; refresh and retry")
    );
  }
}
