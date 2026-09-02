import type { PaymentDomainState } from "../domain/payment";
import type { VerifiedProviderEvent } from "../ports/payment-provider";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import { applyVerifiedProviderEvent } from "./ingest-provider-event";
import { validateSettlement } from "../domain/settlement";

const canonicalStates = new Set<PaymentDomainState>([
  "INITIATED",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

function observation(value: string): VerifiedProviderEvent | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.provider !== "string" ||
      typeof parsed.providerEventId !== "string" ||
      typeof parsed.providerReference !== "string" ||
      typeof parsed.observedAt !== "number" ||
      typeof parsed.payloadHash !== "string" ||
      !["payment", "refund", "subscription", "subscription_invoice"].includes(String(parsed.kind))
    )
      return null;
    if (parsed.kind === "payment" || parsed.kind === "refund") {
      if (
        typeof parsed.canonicalState !== "string" ||
        !canonicalStates.has(parsed.canonicalState as PaymentDomainState) ||
        typeof parsed.amountMinor !== "number" ||
        typeof parsed.currency !== "string" ||
        !(typeof parsed.refundReference === "string" || parsed.refundReference === null)
      )
        return null;
    } else if (parsed.kind === "subscription") {
      if (
        typeof parsed.providerStatus !== "string" ||
        typeof parsed.providerCustomerReference !== "string" ||
        typeof parsed.providerPlanReference !== "string"
      )
        return null;
    } else if (
      typeof parsed.providerSubscriptionReference !== "string" ||
      typeof parsed.providerStatus !== "string" ||
      typeof parsed.amountMinor !== "number" ||
      typeof parsed.currency !== "string"
    )
      return null;
    if (parsed.settlement !== undefined && parsed.settlement !== null) {
      const settlement = parsed.settlement as Record<string, unknown>;
      if (
        typeof settlement !== "object" ||
        typeof settlement.grossMinor !== "number" ||
        typeof settlement.processingCostMinor !== "number" ||
        typeof settlement.withholdingMinor !== "number" ||
        typeof settlement.adjustmentMinor !== "number" ||
        typeof settlement.netMinor !== "number" ||
        typeof settlement.currency !== "string" ||
        typeof settlement.observedAt !== "number" ||
        !validateSettlement(settlement as never)
      )
        return null;
    }
    return parsed as VerifiedProviderEvent;
  } catch {
    return null;
  }
}

export type ProviderInboxRedriveResult = {
  inspected: number;
  claimed: number;
  applied: number;
  retryRequired: number;
  escalated: number;
};

/** Recover due normalized observations without requiring provider redelivery. */
export async function redriveProviderInbox(
  database: D1Database,
  options: { now?: number; limit?: number; leaseMs?: number } = {},
): Promise<ProviderInboxRedriveResult> {
  const now = options.now ?? Date.now();
  const repository = extendPaymentRepository(database);
  const due = await repository.listDueInbox(now, options.limit ?? 50);
  const outcome: ProviderInboxRedriveResult = {
    inspected: due.length,
    claimed: 0,
    applied: 0,
    retryRequired: 0,
    escalated: 0,
  };
  for (const inbox of due) {
    const leaseOwner = crypto.randomUUID();
    if (
      (await repository.claimInbox({
        id: inbox.id,
        leaseOwner,
        now,
        leaseMs: options.leaseMs ?? 30_000,
      })) !== 1
    )
      continue;
    outcome.claimed += 1;

    const event = inbox.normalizedObservationJson
      ? observation(inbox.normalizedObservationJson)
      : null;
    if (!event || event.payloadHash !== inbox.payloadHash) {
      await repository.setInboxStatus({
        id: inbox.id,
        processingStatus: "REJECTED",
        errorCode: "NORMALIZED_OBSERVATION_INVALID",
        now,
        leaseOwner,
      });
      outcome.escalated += 1;
      continue;
    }
    if (inbox.attempts >= 10 || now - inbox.receivedAt >= 24 * 60 * 60 * 1000) {
      await repository.recordReconciliationCase({
        intentId: null,
        category: "AMBIGUOUS_OUTCOME",
        detailsJson: JSON.stringify({
          provider: inbox.provider,
          providerEventId: inbox.providerEventId,
          reason: "INBOX_REDRIVE_EXHAUSTED",
        }),
        now,
      });
      await repository.setInboxStatus({
        id: inbox.id,
        processingStatus: "RECONCILIATION_REQUIRED",
        errorCode: "INBOX_REDRIVE_EXHAUSTED",
        now,
        leaseOwner,
      });
      outcome.escalated += 1;
      continue;
    }
    const applied = await applyVerifiedProviderEvent(database, event, inbox.id, leaseOwner, now);
    if (
      applied.value.processingStatus === "APPLIED" ||
      applied.value.processingStatus === "DUPLICATE"
    )
      outcome.applied += 1;
    else if (applied.value.processingStatus === "RETRY_REQUIRED") outcome.retryRequired += 1;
    else outcome.escalated += 1;
  }
  return outcome;
}
