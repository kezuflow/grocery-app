import { canTransitionPayment, isSufficientForCommitment } from "../domain/payment";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";

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
  provider: string,
  providerEventId: string,
  processingStatus: ProviderEventProcessingStatus,
  paymentIntentId: string | null = null,
  canonicalState: string | null = null,
): { ok: true; value: ProviderEventResult } {
  return {
    ok: true,
    value: { provider, providerEventId, processingStatus, paymentIntentId, canonicalState },
  };
}

function reactionTypeFor(purpose: string): string {
  switch (purpose) {
    case "MEMBERSHIP_ENROLLMENT":
    case "MEMBERSHIP_RENEWAL":
      return "ACTIVATE_MEMBERSHIP";
    case "GROCERY_CHECKOUT":
      return "COMMIT_ORDER";
    case "ORDER_AMENDMENT":
      return "COMMIT_AMENDMENT";
    default:
      return "ACTIVATE_MEMBERSHIP";
  }
}

/**
 * Verify-first durable provider-event ingestion. Signature verification happens
 * through the selected adapter before any identifier is trusted. Inbox identity
 * is `(provider, providerEventId)`; duplicates never reapply effects. The
 * canonical transition uses handler-side compare-and-swap on the stored intent
 * version — provider payloads carry no application `expectedVersion`.
 */
export async function ingestProviderEvent(
  database: D1Database,
  registry: ProviderRegistry,
  providerCode: string,
  headers: Headers,
  rawBody: string,
): Promise<
  { ok: true; value: ProviderEventResult } | { ok: false; error: { code: string; message: string } }
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
      },
    };
  }

  const verification = await provider.verifyAndParseEvent(headers, rawBody);
  if (!verification.ok) {
    return {
      ok: false,
      error: {
        code: "WEBHOOK_VERIFICATION_FAILED",
        message: `Provider event rejected: ${verification.reason}`,
      },
    };
  }

  const event = verification.event;
  const repository = extendPaymentRepository(database);
  const now = Date.now();

  const claimed = await repository.insertInbox({
    provider: event.provider,
    providerEventId: event.providerEventId,
    payloadHash: event.payloadHash,
    now,
  });

  const inboxEntry = await repository.findInboxEntry(event.provider, event.providerEventId);
  if (!inboxEntry) {
    // Should not happen after a successful claim; treat as retryable.
    return result(event.provider, event.providerEventId, "RETRY_REQUIRED");
  }

  if (claimed === 0) {
    if (inboxEntry.payloadHash !== event.payloadHash) {
      // Same event identity with a different payload: integrity violation.
      await repository.setInboxStatus({
        id: inboxEntry.id,
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
      return result(event.provider, event.providerEventId, "REJECTED");
    }
    if (inboxEntry.processingStatus !== "APPLIED" && inboxEntry.processingStatus !== "DUPLICATE") {
      return result(event.provider, event.providerEventId, "RETRY_REQUIRED");
    }
    return result(event.provider, event.providerEventId, "DUPLICATE");
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
    await repository.setInboxStatus({
      id: inboxEntry.id,
      processingStatus: "RECONCILIATION_REQUIRED",
      errorCode: "INTENT_MAPPING_AMBIGUOUS",
      now,
    });
    return result(event.provider, event.providerEventId, "RECONCILIATION_REQUIRED");
  }

  const intent = intents[0];
  if (intent.status === event.canonicalState) {
    await repository.setInboxStatus({ id: inboxEntry.id, processingStatus: "APPLIED", now });
    return result(
      event.provider,
      event.providerEventId,
      "APPLIED",
      intent.id,
      event.canonicalState,
    );
  }
  if (!canTransitionPayment(intent.status as never, event.canonicalState)) {
    await repository.setInboxStatus({
      id: inboxEntry.id,
      processingStatus: "RECONCILIATION_REQUIRED",
      errorCode: "ILLEGAL_TRANSITION",
      now,
    });
    await repository.recordReconciliationCase({
      intentId: intent.id,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({ from: intent.status, to: event.canonicalState }),
      now,
    });
    return result(
      event.provider,
      event.providerEventId,
      "RECONCILIATION_REQUIRED",
      intent.id,
      event.canonicalState,
    );
  }

  const sufficient = isSufficientForCommitment(event.canonicalState);
  const applied = await repository.applyObservationWithReaction({
    intentId: intent.id,
    expectedVersion: intent.version,
    expectedStatus: intent.status,
    nextStatus: event.canonicalState,
    reaction:
      sufficient && intent.status !== "PARTIALLY_REFUNDED" && intent.status !== "REFUNDED"
        ? {
            reactionType: reactionTypeFor(intent.purpose),
            subjectType: intent.subjectType,
            subjectId: intent.subjectId,
            // One reaction identity per intent and type: repeated sufficient
            // observations cannot create duplicate downstream effects.
            idempotencyKey: `reaction:intent:${intent.id}:${reactionTypeFor(intent.purpose)}`,
            now,
          }
        : null,
  });

  if (!applied) {
    // Concurrent command changed the payment; retry or reconcile later.
    await repository.setInboxStatus({
      id: inboxEntry.id,
      processingStatus: "RETRY_REQUIRED",
      errorCode: "VERSION_CONFLICT",
      now,
    });
    return result(
      event.provider,
      event.providerEventId,
      "RETRY_REQUIRED",
      intent.id,
      event.canonicalState,
    );
  }

  await repository.setInboxStatus({ id: inboxEntry.id, processingStatus: "APPLIED", now });
  return result(event.provider, event.providerEventId, "APPLIED", intent.id, event.canonicalState);
}
