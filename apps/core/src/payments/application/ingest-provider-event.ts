import type { VerifiedProviderEvent } from "../ports/payment-provider";
import {
  extendPaymentRepository,
  extendPaymentRepositoryForRefunds,
} from "../infrastructure/d1/payment-repository";
import { applyObservationToIntents } from "./apply-observation";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { recordFinancialEvent } from "./financial-observability";

export type ProviderEventProcessingStatus =
  | "APPLIED"
  | "DUPLICATE"
  | "RETRY_REQUIRED"
  | "RECONCILIATION_REQUIRED"
  | "REJECTED";

export type ProviderEventResult = {
  provider: string;
  providerEventId: string;
  processingStatus: ProviderEventProcessingStatus;
  paymentIntentId: string | null;
  canonicalState: string | null;
};

function result(
  event: Pick<VerifiedProviderEvent, "provider" | "providerEventId">,
  processingStatus: ProviderEventProcessingStatus,
  paymentIntentId: string | null = null,
  canonicalState: string | null = null,
): { ok: true; value: ProviderEventResult } {
  return {
    ok: true,
    value: {
      provider: event.provider,
      providerEventId: event.providerEventId,
      processingStatus,
      paymentIntentId,
      canonicalState,
    },
  };
}

export function normalizedProviderObservation(event: VerifiedProviderEvent): string {
  return JSON.stringify({
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerReference: event.providerReference,
    observedAt: event.observedAt,
    canonicalState: event.canonicalState,
    amountMinor: event.amountMinor,
    currency: event.currency,
    payloadHash: event.payloadHash,
    kind: event.kind,
    refundReference: event.refundReference,
  });
}

/** Apply an already verified, provider-neutral observation under an inbox lease. */
export async function applyVerifiedProviderEvent(
  database: D1Database,
  event: VerifiedProviderEvent,
  inboxId: string,
  leaseOwner: string,
  now = Date.now(),
): Promise<{ ok: true; value: ProviderEventResult }> {
  const repository = extendPaymentRepository(database);
  const finish = (processingStatus: ProviderEventProcessingStatus, errorCode?: string) =>
    repository.setInboxStatus({
      id: inboxId,
      processingStatus,
      errorCode,
      now,
      leaseOwner,
    });

  if (event.kind === "refund" && event.refundReference) {
    const refunds = extendPaymentRepositoryForRefunds(database);
    const refund = await refunds.findRefundByProviderReference(event.refundReference);
    if (!refund) {
      await repository.recordReconciliationCase({
        intentId: null,
        category: "UNMAPPED_PROVIDER_REFERENCE",
        detailsJson: JSON.stringify({
          provider: event.provider,
          refundReference: event.refundReference,
        }),
        now,
      });
      await finish("RECONCILIATION_REQUIRED", "REFUND_UNMAPPED");
      return result(event, "RECONCILIATION_REQUIRED");
    }
    if (refund.status === event.canonicalState) {
      await finish("APPLIED");
      return result(event, "DUPLICATE", refund.paymentIntentId, event.canonicalState);
    }
    const changed = await refunds.updateRefundStatusCas({
      refundId: refund.id,
      expectedVersion: refund.version,
      fromStatus: refund.status,
      toStatus: event.canonicalState,
      now,
    });
    if (changed !== 1) {
      await finish("RETRY_REQUIRED", "VERSION_CONFLICT");
      return result(event, "RETRY_REQUIRED", refund.paymentIntentId, event.canonicalState);
    }
    if (event.canonicalState === "SUCCEEDED") {
      // Recompute from canonical SUCCEEDED refund rows in one guarded SQL
      // statement. Each concurrent refund completion performs this after its
      // own refund CAS, so the last writer necessarily sees the final sum.
      await refunds.refreshIntentRefundState(refund.paymentIntentId, now);
    }
    await finish("APPLIED");
    return result(event, "APPLIED", refund.paymentIntentId, event.canonicalState);
  }

  const intents = await repository.findIntentByProviderReference(
    event.provider,
    event.providerReference,
  );
  if (intents.length !== 1) {
    await repository.recordReconciliationCase({
      intentId: intents[0]?.id ?? null,
      category: intents.length === 0 ? "UNMAPPED_PROVIDER_REFERENCE" : "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: event.provider,
        providerReference: event.providerReference,
        matches: intents.length,
      }),
      now,
    });
    await finish("RECONCILIATION_REQUIRED", "INTENT_MAPPING_AMBIGUOUS");
    return result(event, "RECONCILIATION_REQUIRED");
  }

  const application = await applyObservationToIntents(database, intents, event.canonicalState);
  if (application.processingStatus === "RECONCILIATION_REQUIRED") {
    await finish("RECONCILIATION_REQUIRED", "ILLEGAL_TRANSITION");
    return result(
      event,
      "RECONCILIATION_REQUIRED",
      application.paymentIntentId,
      event.canonicalState,
    );
  }
  if (application.processingStatus === "APPLIED" && event.kind === "payment") {
    const reaction = await database
      .prepare(
        "SELECT id, reaction_type, subject_id FROM payment_reaction WHERE payment_intent_id=? AND status='PENDING' ORDER BY created_at ASC LIMIT 1",
      )
      .bind(application.paymentIntentId)
      .first<{ id: string; reaction_type: string; subject_id: string }>();
    if (
      reaction &&
      (reaction.reaction_type === "ACTIVATE_MEMBERSHIP" ||
        reaction.reaction_type === "RECOVER_MEMBERSHIP")
    ) {
      const { applyMembershipPaymentReaction } =
        await import("../../membership/application/apply-payment-reaction");
      await applyMembershipPaymentReaction(database, {
        reactionId: reaction.id,
        paymentIntentId: application.paymentIntentId!,
        subscriptionId: reaction.subject_id,
        canonicalPaymentState: event.canonicalState,
      });
    }
  }
  if (application.processingStatus === "RETRY_REQUIRED") {
    await finish("RETRY_REQUIRED", "VERSION_CONFLICT");
    return result(event, "RETRY_REQUIRED", application.paymentIntentId, event.canonicalState);
  }
  await finish("APPLIED");
  return result(event, "APPLIED", application.paymentIntentId, event.canonicalState);
}

/** Verify, normalize, persist, lease, and apply one provider event. */
export async function ingestProviderEvent(
  database: D1Database,
  registry: PaymentProviderRegistry,
  providerCode: string,
  headers: Headers,
  rawBody: string,
  requestId: string = crypto.randomUUID(),
): Promise<
  | { ok: true; value: ProviderEventResult }
  | { ok: false; error: { code: string; message: string; requestId: string } }
> {
  let provider;
  try {
    provider = registry.require(providerCode);
  } catch {
    return {
      ok: false,
      error: {
        code: "PAYMENT_PROVIDER_UNCONFIGURED",
        message: `No payment provider is configured for '${providerCode}'`,
        requestId,
      },
    };
  }
  const verification = await provider.verifyAndParseEvent(headers, rawBody);
  if (!verification.ok)
    return {
      ok: false,
      error: {
        code: "WEBHOOK_VERIFICATION_FAILED",
        message: `Provider event rejected: ${verification.reason}`,
        requestId,
      },
    };

  const event = verification.event;
  const repository = extendPaymentRepository(database);
  const now = Date.now();
  const observation = normalizedProviderObservation(event);
  const claimedInsert = await repository.insertInbox({
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerReference: event.providerReference,
    eventType: event.kind,
    payloadHash: event.payloadHash,
    normalizedObservationJson: observation,
    now,
  });
  const inbox = await repository.findInboxEntry(event.provider, event.providerEventId);
  if (!inbox) return result(event, "RETRY_REQUIRED");

  if (claimedInsert === 0 && inbox.payloadHash !== event.payloadHash) {
    await repository.setInboxStatus({
      id: inbox.id,
      processingStatus: "REJECTED",
      errorCode: "PAYLOAD_HASH_MISMATCH",
      now,
    });
    await repository.recordReconciliationCase({
      intentId: null,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: event.provider,
        providerEventId: event.providerEventId,
      }),
      now,
    });
    return result(event, "REJECTED");
  }
  if (inbox.processingStatus === "APPLIED" || inbox.processingStatus === "DUPLICATE") {
    recordFinancialEvent({
      event: "provider_observation_replayed",
      requestId,
      scope: "payments.ingest",
      provider: event.provider,
      aggregateId: event.providerEventId,
      outcomeCode: "DUPLICATE",
    });
    return result(event, "DUPLICATE");
  }

  const leaseOwner = crypto.randomUUID();
  const claimedLease = await repository.claimInbox({
    id: inbox.id,
    leaseOwner,
    now,
    leaseMs: 30_000,
  });
  if (claimedLease !== 1) return result(event, "RETRY_REQUIRED");
  return applyVerifiedProviderEvent(database, event, inbox.id, leaseOwner, now);
}
