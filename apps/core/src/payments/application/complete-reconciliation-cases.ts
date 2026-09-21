import { auditEventStatement } from "../../audit/application/append-audit-event";
import { prepareCommittedFinanceExceptionResolution } from "../../orders/application/resolve-committed-finance-exceptions";
import {
  completedReconciliationResolutionEvidence,
  refundedCommitmentResolutionEvidence,
} from "../infrastructure/d1/reconciliation-resolution";
import { prepareRefundedCommitmentResolution } from "./prepare-refunded-commitment-resolution";

const LIMIT = 20;
const unpaidWindowEvidence = `(
  payment_reconciliation_case.id='payment-lookup:'||payment_reconciliation_case.payment_intent_id
  AND payment_reconciliation_case.category='AMBIGUOUS_OUTCOME'
  AND json_valid(payment_reconciliation_case.details_json)
  AND json_extract(payment_reconciliation_case.details_json,'$.reason')='PAYMENT_LOOKUP_EXHAUSTED'
  AND EXISTS (SELECT 1 FROM payment_lookup_recovery recovery
    WHERE recovery.payment_intent_id=payment_reconciliation_case.payment_intent_id
    AND recovery.status='COMPLETED' AND recovery.last_error_code IS NULL)
  AND EXISTS (SELECT 1 FROM audit_event audit
    WHERE audit.aggregate_id=payment_reconciliation_case.payment_intent_id
    AND audit.action='PAYMENT.UNPAID_WINDOW_CONFIRMED')
)`;

export type ReconciliationCompletionSummary = { considered: number; completed: number };

/**
 * Completes only cases whose owning financial and business effects are already
 * proven. Each case has its own immutable receipt so a partial sweep replays
 * safely and a stale case cannot borrow another case's audit.
 */
export async function completeResolvedReconciliationCases(
  database: D1Database,
  now: number,
): Promise<ReconciliationCompletionSummary> {
  const rows = await database
    .prepare(`SELECT id,payment_intent_id,category,created_at,version,
      (${refundedCommitmentResolutionEvidence}) refunded_commitment
      FROM payment_reconciliation_case
      WHERE status='OPEN' AND ((${completedReconciliationResolutionEvidence}) OR (${refundedCommitmentResolutionEvidence}) OR ${unpaidWindowEvidence})
      ORDER BY created_at,id LIMIT ?`)
    .bind(LIMIT)
    .all<{
      id: string;
      payment_intent_id: string | null;
      category: string;
      created_at: number;
      version: number;
      refunded_commitment: number;
    }>();
  let completed = 0;
  for (const row of rows.results) {
    const key = `automatic-reconciliation-completion:${row.id}:${row.version}`;
    const reason = "Verified financial and owning business effects completed";
    const refundedCleanup = row.refunded_commitment
      ? await prepareRefundedCommitmentResolution(database, {
          caseId: row.id,
          expectedVersion: row.version,
          actorAuthUserId: null,
          reason,
          idempotencyKey: key,
          requestId: key,
          now,
        })
      : [];
    const committedCleanup = await prepareCommittedFinanceExceptionResolution(
      database,
      row.payment_intent_id,
      now,
    );
    try {
      await database.batch([
        ...refundedCleanup,
        ...committedCleanup,
        database
          .prepare(`UPDATE payment_reconciliation_case SET status='RESOLVED',resolved_at=?,version=version+1
            WHERE id=? AND version=? AND status='OPEN' AND payment_intent_id IS ? AND category=? AND created_at=?
            AND ((${completedReconciliationResolutionEvidence}) OR (${refundedCommitmentResolutionEvidence}) OR ${unpaidWindowEvidence})`)
          .bind(now, row.id, row.version, row.payment_intent_id, row.category, row.created_at),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
        auditEventStatement(database, {
          actorUserId: null,
          action: "PAYMENT.RECONCILIATION_AUTOMATICALLY_COMPLETED",
          resourceType: "payment_reconciliation_case",
          resourceId: row.id,
          reason,
          idempotencyKey: key,
          correlationId: key,
          before: { status: "OPEN", version: row.version },
          after: { status: "RESOLVED", version: row.version + 1 },
          occurredAt: now,
        }),
        database
          .prepare(
            "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_AUTOMATICALLY_COMPLETED' AND idempotency_key=?)",
          )
          .bind(row.id, key),
        database
          .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at)
            VALUES ('system.payments.reconciliation-completion',?,?,'SUCCEEDED','reconciliation_case',?,?,?)`)
          .bind(key, key, row.id, now, now),
      ]);
      completed++;
    } catch (error) {
      if (
        error instanceof Error &&
        /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
      )
        continue;
      throw error;
    }
  }
  return { considered: rows.results.length, completed };
}
