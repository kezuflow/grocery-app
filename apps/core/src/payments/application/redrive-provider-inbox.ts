import { paymentDomainStates } from "../domain/payment";
import { z } from "@freshmarkets/validation";
import type { VerifiedProviderEvent } from "../ports/payment-provider";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import { applyVerifiedProviderEvent } from "./ingest-provider-event";
import { validateSettlement } from "../domain/settlement";

const instant = z.number().int().safe();
const money = z.number().int().safe().nonnegative();
const identity = z.object({
  provider: z.string().min(1),
  providerEventId: z.string().min(1),
  providerReference: z.string().min(1),
  observedAt: instant,
  payloadHash: z.string().min(1),
  eventType: z.string().optional(),
});
const settlement = z
  .object({
    grossMinor: money,
    processingCostMinor: money,
    withholdingMinor: money,
    adjustmentMinor: money,
    netMinor: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    observedAt: instant,
  })
  .refine(validateSettlement);
const normalizedObservation = z.discriminatedUnion("kind", [
  identity.extend({
    kind: z.enum(["payment", "refund"]),
    canonicalState: z.enum(paymentDomainStates),
    amountMinor: money.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    refundReference: z.string().nullable(),
    settlement: settlement.optional(),
  }),
  identity.extend({
    kind: z.literal("subscription"),
    providerStatus: z.enum([
      "INCOMPLETE",
      "INCOMPLETE_CANCELED",
      "ACTIVE",
      "PAST_DUE",
      "UNPAID",
      "CANCELED",
    ]),
    providerCustomerReference: z.string(),
    providerPlanReference: z.string(),
    providerPaymentMethodReference: z.string().nullable(),
    latestInvoiceReference: z.string().nullable(),
    nextBillingAt: instant.nullable(),
  }),
  identity.extend({
    kind: z.literal("subscription_invoice"),
    providerSubscriptionReference: z.string(),
    providerPaymentReference: z.string().nullable(),
    providerStatus: z.enum(["DRAFT", "OPEN", "PAID", "VOID"]),
    amountMinor: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    dueAt: instant.nullable(),
    paidAt: instant.nullable(),
  }),
]);
export function parseNormalizedProviderObservation(value: string): VerifiedProviderEvent | null {
  try {
    const input: unknown = JSON.parse(value);
    const parsed = normalizedObservation.safeParse(input);
    return parsed.success ? parsed.data : null;
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
    const exhausted =
      inbox.attempts >= 10 ||
      now - (inbox.recoveryStartedAt ?? inbox.receivedAt) >= 24 * 60 * 60 * 1000;
    if (
      (await repository.claimInbox({
        id: inbox.id,
        leaseOwner,
        now,
        leaseMs: options.leaseMs ?? 30_000,
        expectedAttempts: inbox.attempts,
        countAttempt: !exhausted,
      })) !== 1
    )
      continue;
    outcome.claimed += 1;

    const event = inbox.normalizedObservationJson
      ? parseNormalizedProviderObservation(inbox.normalizedObservationJson)
      : null;
    if (
      inbox.signatureVerifiedAt === null ||
      !event ||
      event.payloadHash !== inbox.payloadHash ||
      event.provider !== inbox.provider ||
      event.providerEventId !== inbox.providerEventId
    ) {
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
    if (exhausted) {
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
    try {
      const applied = await applyVerifiedProviderEvent(database, event, inbox.id, leaseOwner, now);
      if (
        applied.value.processingStatus === "APPLIED" ||
        applied.value.processingStatus === "DUPLICATE"
      )
        outcome.applied += 1;
      else if (applied.value.processingStatus === "RETRY_REQUIRED") outcome.retryRequired += 1;
      else {
        const current = await repository.findInboxEntry(event.provider, event.providerEventId);
        if (current?.availableAt !== null && current?.availableAt !== undefined)
          outcome.retryRequired++;
        else outcome.escalated++;
      }
    } catch {
      await repository.setInboxStatus({
        id: inbox.id,
        processingStatus: "RETRY_REQUIRED",
        errorCode: "INBOX_APPLICATION_FAILED",
        now,
        leaseOwner,
      });
      outcome.retryRequired++;
    }
  }
  return outcome;
}
