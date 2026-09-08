import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { reconcilePayment } from "./reconcile-payment";

const STUCK_THRESHOLD_MS = 15 * 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 10;
const terminal =
  "EXISTS (SELECT 1 FROM payment_intent p WHERE p.id=payment_lookup_recovery.payment_intent_id AND p.status IN ('SUCCEEDED','FAILED','EXPIRED','PARTIALLY_REFUNDED','REFUNDED'))";
export type StuckReconciliationSummary = { considered: number; attempted: number };

/** Durable bounded read-only lookup; a lease never changes canonical payment evidence. */
export async function reconcileStuckPayments(
  database: D1Database,
  registry: PaymentProviderRegistry,
  now: number,
): Promise<StuckReconciliationSummary> {
  await database
    .prepare(`INSERT INTO payment_lookup_recovery(payment_intent_id,status,available_at,created_at,updated_at)
    SELECT p.id,'PENDING',?,?,? FROM payment_intent p
    WHERE p.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING') AND p.updated_at<=?
    AND NOT EXISTS (SELECT 1 FROM payment_lookup_recovery r WHERE r.payment_intent_id=p.id)
    ORDER BY p.updated_at,p.id LIMIT ? ON CONFLICT(payment_intent_id) DO NOTHING`)
    .bind(now, now, now, now - STUCK_THRESHOLD_MS, BATCH_LIMIT)
    .run();
  const due = await database
    .prepare(`SELECT payment_intent_id,attempts,version FROM payment_lookup_recovery
    WHERE (status='PENDING' OR (status='EXHAUSTED' AND ${terminal})) AND available_at<=? ORDER BY available_at,payment_intent_id LIMIT ?`)
    .bind(now, BATCH_LIMIT)
    .all<{ payment_intent_id: string; attempts: number; version: number }>();
  let attempted = 0;
  for (const row of due.results) {
    const token = crypto.randomUUID();
    const claim = await database
      .prepare(`UPDATE payment_lookup_recovery SET status='PENDING',lease_token=?,available_at=?,version=version+1,updated_at=?
      WHERE payment_intent_id=? AND (status='PENDING' OR (status='EXHAUSTED' AND ${terminal})) AND version=? AND available_at<=?`)
      .bind(token, now + LEASE_MS, now, row.payment_intent_id, row.version, now)
      .run();
    if (claim.meta.changes !== 1) continue;
    const state = await database
      .prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(row.payment_intent_id)
      .first<{ status: string }>();
    let errorCode: string | null = null;
    if (
      state &&
      ["INITIATED", "REQUIRES_ACTION", "PROCESSING"].includes(state.status) &&
      row.attempts < MAX_ATTEMPTS
    ) {
      // Count before lookup, including a Worker termination after external observation.
      const counted = await database
        .prepare(
          "UPDATE payment_lookup_recovery SET attempts=attempts+1 WHERE payment_intent_id=? AND lease_token=? AND status='PENDING'",
        )
        .bind(row.payment_intent_id, token)
        .run();
      if (counted.meta.changes !== 1) continue;
      attempted++;
      try {
        const result = await reconcilePayment(database, registry, {
          paymentIntentId: row.payment_intent_id,
          idempotencyKey: `reconcile-sweep:${row.payment_intent_id}`,
          actorId: "system:scheduler",
          requestId: token,
        });
        errorCode =
          !result.ok || result.value.processingStatus === "RECONCILIATION_REQUIRED"
            ? "PROVIDER_LOOKUP_UNRESOLVED"
            : "PAYMENT_STILL_PENDING";
      } catch {
        // Recovery metadata survives a failed local projection. Never persist provider payloads.
        errorCode = "PAYMENT_LOOKUP_APPLICATION_FAILED";
      }
    }
    const caseId = `payment-lookup:${row.payment_intent_id}`;
    const key = `payment-lookup-exhausted:${row.payment_intent_id}:${row.version + 1}`;
    await database.batch([
      database
        .prepare(`UPDATE payment_lookup_recovery SET status=CASE WHEN ${terminal} THEN 'COMPLETED' WHEN attempts>=? THEN 'EXHAUSTED' ELSE 'PENDING' END,
        lease_token=NULL,available_at=?,last_error_code=CASE WHEN ${terminal} THEN NULL ELSE ? END,version=version+1,updated_at=?
        WHERE payment_intent_id=? AND lease_token=? AND status='PENDING'`)
        .bind(
          MAX_ATTEMPTS,
          now + LEASE_MS * 2 ** Math.min(row.attempts, 4),
          errorCode ?? "PAYMENT_LOOKUP_INTERRUPTED",
          now,
          row.payment_intent_id,
          token,
        ),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(`INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at)
        SELECT ?,payment_intent_id,'AMBIGUOUS_OUTCOME','OPEN','{"reason":"PAYMENT_LOOKUP_EXHAUSTED"}',? FROM payment_lookup_recovery
        WHERE payment_intent_id=? AND status='EXHAUSTED' ON CONFLICT(id) DO UPDATE SET status='OPEN',version=payment_reconciliation_case.version+1,resolved_at=NULL`)
        .bind(caseId, now, row.payment_intent_id),
      auditEventStatement(
        database,
        {
          actorUserId: null,
          action: "PAYMENT.LOOKUP_EXHAUSTED",
          resourceType: "payment_intent",
          resourceId: row.payment_intent_id,
          reason: "Bounded provider lookup requires operator review",
          idempotencyKey: key,
          correlationId: token,
          occurredAt: now,
        },
        {
          clause:
            "EXISTS (SELECT 1 FROM payment_lookup_recovery WHERE payment_intent_id=? AND status='EXHAUSTED')",
          binds: [row.payment_intent_id],
        },
      ),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM payment_lookup_recovery WHERE payment_intent_id=? AND status='EXHAUSTED') AND
        (NOT EXISTS (SELECT 1 FROM payment_reconciliation_case WHERE id=? AND status='OPEN') OR NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.LOOKUP_EXHAUSTED' AND idempotency_key=?))`)
        .bind(row.payment_intent_id, caseId, row.payment_intent_id, key),
    ]);
  }
  return { considered: due.results.length, attempted };
}
