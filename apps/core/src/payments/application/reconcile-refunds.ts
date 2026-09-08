import { auditEventStatement } from "../../audit/application/append-audit-event";
import { synchronizeOrderCancellationForPayment } from "../../orders/application/advance-order-cancellation";
import {
  extendPaymentRepositoryForRefunds,
  refundStatusChangeStatements,
} from "../infrastructure/d1/payment-repository";
import type { ProviderRefundLookupResult } from "../ports/payment-provider";
import type { PaymentProviderRegistry } from "../ports/provider-registry";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const due = `(status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED') AND attempt_count<${MAX_ATTEMPTS} AND COALESCE(next_retry_at,created_at+60000)<=?) OR (status IN ('SUCCEEDED','FAILED') AND attempt_count<${MAX_ATTEMPTS} AND next_retry_at IS NOT NULL AND next_retry_at<=?)`;
type RecoveryRow = {
  id: string;
  payment_intent_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  version: number;
  idempotency_key: string;
  provider_refund_reference: string | null;
  attempt_count: number;
};

/** Payments owns bounded read-only recovery. A missing observation never permits another POST. */
export async function reconcileRefunds(
  database: D1Database,
  registry: PaymentProviderRegistry,
  now: number,
): Promise<{ considered: number; attempted: number; unresolved: number }> {
  const rows = await database
    .prepare(
      `SELECT id,payment_intent_id,amount_minor,currency,status,version,idempotency_key,provider_refund_reference,attempt_count FROM payment_refund WHERE ${due} ORDER BY COALESCE(next_retry_at,created_at),id LIMIT 5`,
    )
    .bind(now, now)
    .all<RecoveryRow>();
  let attempted = 0,
    unresolved = 0;
  for (const row of rows.results) {
    const claim = await database
      .prepare(
        `UPDATE payment_refund SET processing_started_at=?,next_retry_at=?,attempt_count=attempt_count+1,version=version+1 WHERE id=? AND version=? AND (${due})`,
      )
      .bind(now, now + LEASE_MS, row.id, row.version, now, now)
      .run();
    if (claim.meta.changes !== 1) continue;
    attempted++;
    const claimed = { ...row, version: row.version + 1, attempt_count: row.attempt_count + 1 };
    try {
      if (row.status === "SUCCEEDED" || row.status === "FAILED") {
        await finishProjection(database, claimed, now);
        continue;
      }
      const attempts = await database
        .prepare(
          "SELECT provider,provider_reference FROM payment_attempt WHERE payment_intent_id=? AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') LIMIT 2",
        )
        .bind(row.payment_intent_id)
        .all<{ provider: string; provider_reference: string | null }>();
      const attempt = attempts.results.length === 1 ? attempts.results[0] : null;
      const provider = attempt ? registry.get(attempt.provider) : null;
      let result: ProviderRefundLookupResult = { outcome: "UNRESOLVED", reason: "UNSUPPORTED" };
      if (attempt?.provider_reference && provider?.lookupRefund) {
        try {
          result = await provider.lookupRefund({
            providerReference: attempt.provider_reference,
            providerRefundReference: row.provider_refund_reference,
            refundProviderIdempotencyKey: row.idempotency_key,
          });
        } catch {
          result = { outcome: "UNRESOLVED", reason: "UNAVAILABLE" };
        }
      }
      if (result.outcome === "UNRESOLVED" || !attempt?.provider_reference) {
        await recordUnresolved(
          database,
          claimed,
          result.outcome === "UNRESOLVED" ? result.reason : "MISMATCH",
          now,
        );
        unresolved++;
        continue;
      }
      const observation = result.refund;
      if (
        observation.providerReference !== attempt.provider_reference ||
        !observation.providerRefundReference ||
        (row.provider_refund_reference !== null &&
          observation.providerRefundReference !== row.provider_refund_reference) ||
        (observation.idempotencyKey !== row.idempotency_key &&
          (row.provider_refund_reference === null || observation.idempotencyKey !== null)) ||
        observation.amountMinor !== row.amount_minor ||
        observation.currency !== row.currency ||
        !Number.isSafeInteger(observation.observedAt) ||
        observation.observedAt < 0 ||
        observation.observedAt > Date.now() + 60_000
      ) {
        await recordUnresolved(database, claimed, "MISMATCH", now);
        unresolved++;
        continue;
      }
      const auditKey = `refund-lookup:${row.id}:${claimed.version}`;
      await database.batch([
        ...refundStatusChangeStatements(database, {
          refundId: row.id,
          paymentIntentId: row.payment_intent_id,
          expectedVersion: claimed.version,
          fromStatus: row.status,
          toStatus: observation.canonicalState,
          providerRefundReference: observation.providerRefundReference,
          observation: {
            provider: attempt.provider,
            providerReference: observation.providerRefundReference,
            lookupPaymentReference: attempt.provider_reference,
            lookupIdempotencyKey: row.idempotency_key,
            amountMinor: observation.amountMinor,
            currency: observation.currency,
          },
          now,
        }),
        database
          .prepare(
            "UPDATE payment_refund SET provider_observed_at=?,last_error_code=NULL,attempt_count=CASE WHEN status IN ('SUCCEEDED','FAILED') THEN 0 ELSE attempt_count END WHERE id=? AND version=?",
          )
          .bind(observation.observedAt, row.id, claimed.version + 1),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
        auditEventStatement(database, {
          actorUserId: null,
          action: "payments.refund.provider-observed",
          resourceType: "payment_refund",
          resourceId: row.id,
          details: { state: observation.canonicalState, source: "PROVIDER_LOOKUP" },
          correlationId: auditKey,
          idempotencyKey: auditKey,
          occurredAt: now,
        }),
        database
          .prepare(
            "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action=? AND idempotency_key=?)",
          )
          .bind(row.id, "payments.refund.provider-observed", auditKey),
      ]);
      const observed = {
        ...claimed,
        attempt_count: observation.canonicalState === "PROCESSING" ? claimed.attempt_count : 0,
        status: observation.canonicalState,
        version: claimed.version + 1,
      };
      if (observed.status === "PROCESSING") {
        await recordUnresolved(database, observed, "PROVIDER_PROCESSING", now);
        unresolved++;
      } else await finishProjection(database, observed, now);
    } catch {
      // Keep the leased intent recoverable after database/projection failure; no financial retry is submitted.
      const current = await database
        .prepare(
          "SELECT id,payment_intent_id,amount_minor,currency,status,version,idempotency_key,provider_refund_reference,attempt_count FROM payment_refund WHERE id=? AND processing_started_at=? AND version IN (?,?)",
        )
        .bind(row.id, now, claimed.version, claimed.version + 1)
        .first<RecoveryRow>();
      if (current) await recordUnresolved(database, current, "RECOVERY_APPLICATION_FAILED", now);
      unresolved++;
    }
  }
  return { considered: rows.results.length, attempted, unresolved };
}

async function finishProjection(
  database: D1Database,
  row: RecoveryRow,
  now: number,
): Promise<void> {
  if (row.status === "SUCCEEDED")
    await extendPaymentRepositoryForRefunds(database).refreshIntentRefundState(
      row.payment_intent_id,
      now,
    );
  await synchronizeOrderCancellationForPayment(database, row.payment_intent_id);
  if (row.status === "FAILED") await recordUnresolved(database, row, "PROVIDER_FAILED", now);
  // Clear recovery only after dependent projections completed. A crash leaves the lease due again.
  const auditKey = `refund-recovery-completed:${row.id}:${row.version}`;
  await database.batch([
    database
      .prepare(
        "UPDATE payment_refund SET next_retry_at=NULL,processing_started_at=NULL,last_error_code=? WHERE id=? AND version=? AND status=?",
      )
      .bind(row.status === "FAILED" ? "PROVIDER_FAILED" : null, row.id, row.version, row.status),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    database
      .prepare(
        "UPDATE payment_reconciliation_case SET status='RESOLVED',resolved_at=?,version=version+1 WHERE id=(SELECT reconciliation_case_id FROM payment_refund WHERE id=?) AND status='OPEN' AND category='REFUND_UNRESOLVED' AND ?='SUCCEEDED'",
      )
      .bind(now, row.id, row.status),
    auditEventStatement(database, {
      actorUserId: null,
      action: "payments.refund.recovery-completed",
      resourceType: "payment_refund",
      resourceId: row.id,
      details: { state: row.status },
      correlationId: auditKey,
      idempotencyKey: auditKey,
      occurredAt: now,
    }),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='payments.refund.recovery-completed' AND idempotency_key=?)",
      )
      .bind(row.id, auditKey),
  ]);
}

async function recordUnresolved(
  database: D1Database,
  row: RecoveryRow,
  reason: string,
  now: number,
): Promise<void> {
  const caseId = `refund-recovery:${row.id}`;
  const auditKey = `refund-unresolved:${row.id}:${row.version}`;
  const next = now + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(row.attempt_count, 6));
  await database.batch([
    database
      .prepare(
        "INSERT OR IGNORE INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) SELECT ?,payment_intent_id,'REFUND_UNRESOLVED','OPEN',?,? FROM payment_refund WHERE id=? AND version=?",
      )
      .bind(caseId, JSON.stringify({ refundId: row.id, reason }), now, row.id, row.version),
    database
      .prepare(
        "UPDATE payment_reconciliation_case SET status='OPEN',resolved_at=NULL,version=version+1 WHERE status='RESOLVED' AND id=? AND EXISTS (SELECT 1 FROM payment_refund WHERE id=? AND version=?)",
      )
      .bind(caseId, row.id, row.version),
    database
      .prepare(
        "UPDATE payment_refund SET next_retry_at=?,processing_started_at=NULL,last_error_code=?,reconciliation_case_id=? WHERE id=? AND version=?",
      )
      .bind(next, reason, caseId, row.id, row.version),
    auditEventStatement(
      database,
      {
        actorUserId: null,
        action: "payments.refund.recovery-unresolved",
        resourceType: "payment_refund",
        resourceId: row.id,
        reason,
        details: { attempts: row.attempt_count, caseId },
        idempotencyKey: auditKey,
        correlationId: auditKey,
        occurredAt: now,
      },
      {
        clause:
          "EXISTS (SELECT 1 FROM payment_refund WHERE id=? AND version=?) AND NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='payments.refund.recovery-unresolved' AND idempotency_key=?)",
        binds: [row.id, row.version, row.id, auditKey],
      },
    ),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM payment_refund WHERE id=? AND version=?) AND NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='payments.refund.recovery-unresolved' AND idempotency_key=?)",
      )
      .bind(row.id, row.version, row.id, auditKey),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM payment_refund WHERE id=? AND version=? AND (reconciliation_case_id IS NOT ? OR last_error_code IS NOT ? OR next_retry_at IS NOT ?))",
      )
      .bind(row.id, row.version, caseId, reason, next),
  ]);
}
