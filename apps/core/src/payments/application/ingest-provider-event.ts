import {
  extendPaymentRepository,
  extendPaymentRepositoryForRefunds,
} from "../infrastructure/d1/payment-repository";
import { applyObservationToIntents } from "./apply-observation";
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
      await repository.setInboxStatus({
        id: inboxEntry.id,
        processingStatus: "RECONCILIATION_REQUIRED",
        errorCode: "REFUND_UNMAPPED",
        now,
      });
      return result(event.provider, event.providerEventId, "RECONCILIATION_REQUIRED");
    }
    if (refund.status === event.canonicalState) {
      await repository.setInboxStatus({ id: inboxEntry.id, processingStatus: "APPLIED", now });
      return result(
        event.provider,
        event.providerEventId,
        "DUPLICATE",
        refund.paymentIntentId,
        event.canonicalState,
      );
    }
    const changed = await refunds.updateRefundStatusCas({
      refundId: refund.id,
      expectedVersion: refund.version,
      fromStatus: refund.status,
      toStatus: event.canonicalState,
      now,
    });
    if (changed !== 1) {
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
        refund.paymentIntentId,
        event.canonicalState,
      );
    }
    if (event.canonicalState === "SUCCEEDED") {
      // Reflect aggregate refund progression on the payment itself.
      const intent = await refunds.findIntentById(refund.paymentIntentId);
      if (intent && intent.status === "SUCCEEDED") {
        const total = await refunds.succeededRefundSum(intent.id);
        const next = total >= intent.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
        await refunds
          .updateIntentStatusCas({
            intentId: intent.id,
            expectedVersion: intent.version,
            fromStatus: "SUCCEEDED",
            toStatus: next,
            now,
          })
          .run();
      }
    }
    await repository.setInboxStatus({ id: inboxEntry.id, processingStatus: "APPLIED", now });
    return result(
      event.provider,
      event.providerEventId,
      "APPLIED",
      refund.paymentIntentId,
      event.canonicalState,
    );
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

  const application = await applyObservationToIntents(database, intents, event.canonicalState);
  if (application.processingStatus === "RECONCILIATION_REQUIRED") {
    await repository.setInboxStatus({
      id: inboxEntry.id,
      processingStatus: "RECONCILIATION_REQUIRED",
      errorCode: "ILLEGAL_TRANSITION",
      now,
    });
    return result(
      event.provider,
      event.providerEventId,
      "RECONCILIATION_REQUIRED",
      application.paymentIntentId,
      event.canonicalState,
    );
  }
  if (application.processingStatus === "APPLIED" && event.kind === "payment") {
    // Dispatch any durable downstream reaction created by this observation.
    const reaction = await database
      .prepare(
        "SELECT id, subject_id FROM payment_reaction WHERE payment_intent_id=? AND status='PENDING' ORDER BY created_at ASC LIMIT 1",
      )
      .bind(application.paymentIntentId)
      .first<{ id: string; subject_id: string }>();
    if (reaction) {
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
      application.paymentIntentId,
      event.canonicalState,
    );
  }

  await repository.setInboxStatus({ id: inboxEntry.id, processingStatus: "APPLIED", now });
  return result(
    event.provider,
    event.providerEventId,
    "APPLIED",
    application.paymentIntentId,
    event.canonicalState,
  );
}
