import { auditEventStatement } from "../../audit/application/append-audit-event";
import type { VerifiedFinancialProviderEvent } from "../ports/payment-provider";

/** Associate a previously unknown reference only after verified application; never close financial review. */
export async function linkProviderReconciliationCases(
  database: D1Database,
  event: VerifiedFinancialProviderEvent,
  paymentIntentId: string,
  now: number,
): Promise<void> {
  const reference = event.kind === "refund" ? event.refundReference : event.providerReference;
  if (!reference) return;
  const path = event.kind === "refund" ? "$.refundReference" : "$.providerReference";
  const cases = await database
    .prepare(`SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id IS NULL AND status='OPEN'
    AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.provider') END=?
    AND ((category='UNMAPPED_PROVIDER_REFERENCE' AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,?) END=?)
      OR (category='AMBIGUOUS_OUTCOME' AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.reason') END='INBOX_REDRIVE_EXHAUSTED'
        AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.providerEventId') END=?))`)
    .bind(event.provider, path, reference, event.providerEventId)
    .all<{ id: string; version: number }>();
  if (!cases.results.length) return;
  const mapping =
    event.kind === "refund"
      ? `SELECT r.payment_intent_id id FROM payment_refund r WHERE r.provider_refund_reference=? AND r.amount_minor=? AND r.currency=?
       AND EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=r.payment_intent_id AND a.provider=? AND a.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
       AND NOT EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=r.payment_intent_id AND a.provider!=? AND a.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))`
      : `SELECT p.id FROM payment_intent p JOIN payment_attempt a ON a.payment_intent_id=p.id WHERE a.provider_reference=? AND p.amount_minor=? AND p.currency=? AND a.provider=?`;
  const binds =
    event.kind === "refund"
      ? [reference, event.amountMinor, event.currency, event.provider, event.provider]
      : [reference, event.amountMinor, event.currency, event.provider];
  for (const row of cases.results) {
    const key = `provider-case-link:${row.id}:${paymentIntentId}`;
    await database.batch([
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE (SELECT COUNT(*) FROM (${mapping}))!=1 OR NOT EXISTS (SELECT 1 FROM (${mapping}) WHERE id=?)`,
        )
        .bind(...binds, ...binds, paymentIntentId),
      database
        .prepare(
          "UPDATE payment_reconciliation_case SET payment_intent_id=?,version=version+1 WHERE id=? AND version=? AND payment_intent_id IS NULL AND status='OPEN'",
        )
        .bind(paymentIntentId, row.id, row.version),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: null,
        action: "PAYMENT.RECONCILIATION_LINKED",
        resourceType: "payment_reconciliation_case",
        resourceId: row.id,
        reason: "Verified provider mapping became available",
        idempotencyKey: key,
        correlationId: event.providerEventId,
        occurredAt: now,
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_LINKED' AND idempotency_key=?)",
        )
        .bind(row.id, key),
    ]);
  }
}
