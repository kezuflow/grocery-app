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

async function completeVerifiedUnpaidWindow(
  database: D1Database,
  paymentIntentId: string,
  token: string,
  expectedPaymentVersion: number,
  expectedAttemptId: string,
  deadline: number,
  now: number,
) {
  const key = `payment-unpaid-window-confirmed:${paymentIntentId}:${deadline}`;
  await database.batch([
    database
      .prepare(`UPDATE payment_lookup_recovery SET status='COMPLETED',attempts=0,lease_token=NULL,
        available_at=?,last_error_code=NULL,version=version+1,updated_at=?
        WHERE payment_intent_id=? AND lease_token=? AND status='PENDING'
        AND EXISTS (SELECT 1 FROM payment_intent p WHERE p.id=? AND p.version=? AND p.status IN ('INITIATED','REQUIRES_ACTION'))
        AND EXISTS (SELECT 1 FROM payment_attempt a WHERE a.id=? AND a.payment_intent_id=? AND a.status IN ('INITIATED','REQUIRES_ACTION'))
        AND EXISTS (SELECT 1 FROM payment_provider_action a WHERE a.payment_intent_id=? AND a.expires_at=? AND a.expires_at<=?)
        AND NOT EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=? AND a.status='SUCCEEDED')
        AND NOT EXISTS (SELECT 1 FROM payment_refund r WHERE r.payment_intent_id=?)
        AND NOT EXISTS (SELECT 1 FROM payment_reaction r WHERE r.payment_intent_id=?)
        AND NOT EXISTS (SELECT 1 FROM payment_provider_event_inbox i JOIN payment_attempt a ON a.provider=i.provider AND a.provider_reference=i.provider_reference WHERE a.payment_intent_id=? AND i.processing_status IN ('RECEIVED','RETRY_REQUIRED','RECONCILIATION_REQUIRED'))`)
      .bind(
        now,
        now,
        paymentIntentId,
        token,
        paymentIntentId,
        expectedPaymentVersion,
        expectedAttemptId,
        paymentIntentId,
        paymentIntentId,
        deadline,
        now,
        paymentIntentId,
        paymentIntentId,
        paymentIntentId,
        paymentIntentId,
      ),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    auditEventStatement(database, {
      actorUserId: null,
      action: "PAYMENT.UNPAID_WINDOW_CONFIRMED",
      resourceType: "payment_intent",
      resourceId: paymentIntentId,
      reason:
        "Provider confirmed that customer action was still awaited after the continuation window",
      idempotencyKey: key,
      correlationId: token,
      occurredAt: now,
    }),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.UNPAID_WINDOW_CONFIRMED' AND idempotency_key=?)",
      )
      .bind(paymentIntentId, key),
  ]);
}

/** Durable bounded read-only lookup; a lease never changes canonical payment evidence. */
export async function reconcileStuckPayments(
  database: D1Database,
  registry: PaymentProviderRegistry,
  now: number,
): Promise<StuckReconciliationSummary> {
  const historical = await database
    .prepare(`SELECT recovery.payment_intent_id,recovery.version
      FROM payment_lookup_recovery recovery
      JOIN payment_intent payment ON payment.id=recovery.payment_intent_id
      WHERE recovery.status='EXHAUSTED' AND recovery.last_error_code='PAYMENT_STILL_PENDING'
      AND payment.status IN ('INITIATED','REQUIRES_ACTION')
      AND EXISTS (SELECT 1 FROM payment_provider_action action WHERE action.payment_intent_id=payment.id AND action.expires_at<=?)
      AND NOT EXISTS (SELECT 1 FROM audit_event audit WHERE audit.aggregate_id=payment.id AND audit.action='PAYMENT.HISTORICAL_WAITING_RECHECK_STARTED')
      ORDER BY recovery.available_at,recovery.payment_intent_id LIMIT ?`)
    .bind(now, BATCH_LIMIT)
    .all<{ payment_intent_id: string; version: number }>();
  for (const row of historical.results) {
    const key = `historical-waiting-recheck:${row.payment_intent_id}:${row.version}`;
    try {
      await database.batch([
        database
          .prepare(`UPDATE payment_lookup_recovery SET status='PENDING',attempts=0,available_at=?,lease_token=NULL,last_error_code=NULL,version=version+1,updated_at=?
          WHERE payment_intent_id=? AND version=? AND status='EXHAUSTED' AND last_error_code='PAYMENT_STILL_PENDING'`)
          .bind(now, now, row.payment_intent_id, row.version),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
        auditEventStatement(database, {
          actorUserId: null,
          action: "PAYMENT.HISTORICAL_WAITING_RECHECK_STARTED",
          resourceType: "payment_intent",
          resourceId: row.payment_intent_id,
          reason: "One bounded post-window verification for retained waiting evidence",
          idempotencyKey: key,
          correlationId: key,
          occurredAt: now,
        }),
        database
          .prepare(
            "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.HISTORICAL_WAITING_RECHECK_STARTED' AND idempotency_key=?)",
          )
          .bind(row.payment_intent_id, key),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
      )
        continue;
      throw error;
    }
  }
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
      .prepare(`SELECT p.status,p.version,
        (SELECT a.id FROM payment_attempt a WHERE a.payment_intent_id=p.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) attempt_id,
        (SELECT MAX(a.expires_at) FROM payment_provider_action a WHERE a.payment_intent_id=p.id) deadline
        FROM payment_intent p WHERE p.id=?`)
      .bind(row.payment_intent_id)
      .first<{
        status: string;
        version: number;
        attempt_id: string | null;
        deadline: number | null;
      }>();
    let errorCode: string | null = null;
    let waitingUntil: number | null = null;
    let verifiedExpiredWaiting = false;
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
          recordUnavailableCase: false,
        });
        if (!result.ok) errorCode = "PROVIDER_LOOKUP_UNRESOLVED";
        else if (result.value.lookupOutcome === "AWAITING_CUSTOMER") {
          if (state.deadline !== null && now < state.deadline) waitingUntil = state.deadline;
          else if (state.deadline !== null && state.attempt_id !== null)
            verifiedExpiredWaiting = true;
          else errorCode = "PAYMENT_LOOKUP_MISSING_CONTINUATION";
        } else if (result.value.lookupOutcome === "PROCESSING")
          errorCode = "PAYMENT_CONFIRMATION_PENDING";
        else if (result.value.lookupOutcome === "TERMINAL") errorCode = null;
        else if (result.value.lookupOutcome === "IDENTITY_MISMATCH")
          errorCode = "PROVIDER_LOOKUP_IDENTITY_MISMATCH";
        else if (result.value.lookupOutcome === "LOOKUP_UNAVAILABLE")
          errorCode = "PROVIDER_LOOKUP_UNAVAILABLE";
        else errorCode = "PAYMENT_LOOKUP_APPLICATION_FAILED";
      } catch {
        // Recovery metadata survives a failed local projection. Never persist provider payloads.
        errorCode = "PAYMENT_LOOKUP_APPLICATION_FAILED";
      }
    }
    if (verifiedExpiredWaiting && state?.attempt_id && state.deadline !== null) {
      await completeVerifiedUnpaidWindow(
        database,
        row.payment_intent_id,
        token,
        state.version,
        state.attempt_id,
        state.deadline,
        now,
      );
      continue;
    }
    if (waitingUntil !== null) {
      await database.batch([
        database
          .prepare(`UPDATE payment_lookup_recovery SET status='PENDING',attempts=0,lease_token=NULL,available_at=?,last_error_code=NULL,version=version+1,updated_at=?
            WHERE payment_intent_id=? AND lease_token=? AND status='PENDING'
            AND EXISTS (SELECT 1 FROM payment_intent WHERE id=? AND version=? AND status IN ('INITIATED','REQUIRES_ACTION'))
            AND EXISTS (SELECT 1 FROM payment_provider_action WHERE payment_intent_id=? AND expires_at=? AND expires_at>?)`)
          .bind(
            waitingUntil,
            now,
            row.payment_intent_id,
            token,
            row.payment_intent_id,
            state?.version,
            row.payment_intent_id,
            waitingUntil,
            now,
          ),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      ]);
      continue;
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
