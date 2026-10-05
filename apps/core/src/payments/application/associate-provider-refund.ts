import { auditEventStatement } from "../../audit/application/append-audit-event";
import { replaceRejectedCancellationRefundStatements } from "../../orders/application/replace-rejected-cancellation-refund";
import {
  extendPaymentRepositoryForRefunds,
  refundBudgetStatement,
  refundStatusChangeStatements,
  type RefundRow,
} from "../infrastructure/d1/payment-repository";
import type { VerifiedFinancialProviderEvent } from "../ports/payment-provider";
import type { PaymentProviderRegistry } from "../ports/provider-registry";

/** A signed unknown refund also needs current provider Payment ownership before association. */
export async function associateProviderRefund(
  database: D1Database,
  registry: PaymentProviderRegistry | undefined,
  event: VerifiedFinancialProviderEvent,
  now: number,
): Promise<RefundRow | null> {
  if (!registry || !event.refundReference) return null;
  const provider = registry.require(event.provider);
  if (!provider.lookupExternalRefund) return null;
  const lookup = await provider.lookupExternalRefund({
    providerPaymentReference: event.providerReference,
    providerRefundReference: event.refundReference,
  });
  if (lookup.outcome !== "FOUND") return null;
  const observation = lookup.refund;
  if (
    observation.providerRefundReference !== event.refundReference ||
    observation.amountMinor !== event.amountMinor ||
    observation.currency !== event.currency ||
    !Number.isSafeInteger(observation.observedAt) ||
    observation.observedAt < 0 ||
    observation.observedAt > now + 60_000
  )
    return null;
  if (
    ["SUCCEEDED", "FAILED"].includes(event.canonicalState) &&
    observation.canonicalState !== event.canonicalState
  )
    return null;
  const repository = extendPaymentRepositoryForRefunds(database);
  const mapped = await database
    .prepare(`SELECT DISTINCT pi.id,pi.version FROM payment_intent pi JOIN payment_attempt a ON a.payment_intent_id=pi.id
    WHERE a.provider=? AND a.provider_reference=? AND a.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
      AND pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND pi.currency=? AND pi.amount_minor>=?
      AND NOT EXISTS (SELECT 1 FROM payment_attempt other WHERE other.payment_intent_id=pi.id AND other.provider!=? AND other.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) LIMIT 2`)
    .bind(
      event.provider,
      observation.providerReference,
      event.currency,
      event.amountMinor,
      event.provider,
    )
    .all<{ id: string; version: number }>();
  if (mapped.results.length !== 1) return null;
  const intent = mapped.results[0];
  // A webhook can beat our submission response. Match its exact key rather than import another amount.
  if (observation.idempotencyKey) {
    const existing = await repository.findRefundByIdempotencyKey(observation.idempotencyKey);
    if (
      !existing ||
      existing.paymentIntentId !== intent.id ||
      existing.amountMinor !== event.amountMinor ||
      existing.currency !== event.currency ||
      !["REQUESTED", "APPROVED", "PROCESSING", "ESCALATED"].includes(existing.status) ||
      existing.providerRefundReference !== null
    )
      return null;
    await repository.updateRefundStatusCas({
      refundId: existing.id,
      paymentIntentId: intent.id,
      expectedVersion: existing.version,
      fromStatus: existing.status,
      toStatus: "PROCESSING",
      providerRefundReference: event.refundReference,
      claimAction: observation.claimAction,
      observation: {
        provider: event.provider,
        providerReference: event.refundReference,
        lookupPaymentReference: observation.providerReference,
        lookupIdempotencyKey: observation.idempotencyKey,
        amountMinor: event.amountMinor,
        currency: event.currency,
      },
      now,
    });
    return repository.findRefundByProviderReference(event.refundReference, event.provider);
  }
  const members = await database
    .prepare(`SELECT r.id,r.version,r.amount_minor,r.currency,r.status,r.provider_refund_reference
    FROM order_cancellation_refund_member m JOIN order_cancellation c ON c.id=m.cancellation_id
    LEFT JOIN payment_refund r ON r.id=m.refund_id WHERE m.payment_intent_id=? AND c.status!='COMPLETED'`)
    .bind(intent.id)
    .all<{
      id: string;
      version: number;
      amount_minor: number;
      currency: string;
      status: string;
      provider_refund_reference: string | null;
    }>();
  if (members.results.length > 1) return null;
  const rejected = members.results[0];
  if (
    rejected &&
    (rejected.status !== "REJECTED" ||
      rejected.provider_refund_reference !== null ||
      rejected.amount_minor !== event.amountMinor ||
      rejected.currency !== event.currency)
  )
    return null;
  const refundId = crypto.randomUUID(),
    effectKey = `provider-refund:${event.provider}:${event.refundReference}`;
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM payment_intent pi WHERE id=? AND version=?
        AND EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=pi.id AND a.provider=? AND a.provider_reference=? AND a.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
        AND NOT EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=pi.id AND a.provider!=? AND a.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')))
        OR EXISTS (SELECT 1 FROM payment_refund r WHERE provider_refund_reference=? AND EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=r.payment_intent_id AND a.provider=?))`)
        .bind(
          intent.id,
          intent.version,
          event.provider,
          observation.providerReference,
          event.provider,
          event.refundReference,
          event.provider,
        ),
      ...(rejected
        ? [
            database
              .prepare(
                `UPDATE payment_refund SET version=version+1,updated_at=? WHERE id=? AND version=? AND status='REJECTED' AND provider_refund_reference IS NULL`,
              )
              .bind(now, rejected.id, rejected.version),
            database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
          ]
        : []),
      refundBudgetStatement(database, {
        refundId,
        intentId: intent.id,
        amountMinor: event.amountMinor,
        reason: "Verified provider dashboard refund",
        idempotencyKey: effectKey,
        replacesRejectedRefundId: rejected?.id,
        now,
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      ...(rejected
        ? replaceRejectedCancellationRefundStatements(database, {
            rejectedRefundId: rejected.id,
            replacementRefundId: refundId,
            now,
          })
        : []),
      ...refundStatusChangeStatements(database, {
        refundId,
        paymentIntentId: intent.id,
        expectedVersion: 1,
        fromStatus: "REQUESTED",
        toStatus: "PROCESSING",
        providerRefundReference: event.refundReference,
        claimAction: observation.claimAction,
        now,
      }),
      auditEventStatement(database, {
        actorUserId: null,
        action: "PAYMENT.EXTERNAL_REFUND_RECORDED",
        resourceType: "payment_refund",
        resourceId: refundId,
        reason: "Verified signed event and provider Payment/refund ownership",
        idempotencyKey: effectKey,
        correlationId: event.providerEventId,
        details: {
          amountMinor: event.amountMinor,
          currency: event.currency,
          replacedRejectedRefundId: rejected?.id ?? null,
        },
        occurredAt: now,
      }),
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.EXTERNAL_REFUND_RECORDED' AND idempotency_key=?)`,
        )
        .bind(refundId, effectKey),
    ]);
  } catch (error) {
    const raced = await repository.findRefundByProviderReference(
      event.refundReference,
      event.provider,
    );
    if (raced) return raced;
    if (error instanceof Error && /constraint failed/i.test(error.message)) return null;
    throw error;
  }
  return repository.findRefundByProviderReference(event.refundReference, event.provider);
}
