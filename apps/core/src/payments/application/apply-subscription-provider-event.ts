import {
  findSubscriptionTransitionPath,
  type SubscriptionLifecycleState,
} from "../../membership/domain/subscription";
import type {
  VerifiedSubscriptionInvoiceProviderEvent,
  VerifiedSubscriptionProviderEvent,
} from "../ports/payment-provider";

export type SubscriptionProviderApplication =
  | { processingStatus: "APPLIED" | "DUPLICATE"; subscriptionId: string }
  | {
      processingStatus: "RETRY_REQUIRED" | "RECONCILIATION_REQUIRED";
      subscriptionId: string | null;
      errorCode: string;
    };

function canonicalStatus(
  providerStatus: VerifiedSubscriptionProviderEvent["providerStatus"],
): SubscriptionLifecycleState {
  switch (providerStatus) {
    case "INCOMPLETE":
      return "PENDING";
    case "INCOMPLETE_CANCELED":
      return "EXPIRED";
    case "ACTIVE":
      return "ACTIVE";
    case "PAST_DUE":
      return "PAST_DUE";
    case "UNPAID":
      return "UNPAID";
    case "CANCELED":
      return "CANCELED";
  }
}

export async function applySubscriptionProviderEvent(
  database: D1Database,
  event: VerifiedSubscriptionProviderEvent,
  now: number,
): Promise<SubscriptionProviderApplication> {
  const mapping = await database
    .prepare(
      `SELECT ps.id, ps.subscription_id, ps.customer_id, ps.provider_plan_reference,
              ps.provider_customer_reference, ps.provider_status, ps.provider_observed_at,
              s.status AS subscription_status, s.version AS subscription_version
       FROM payment_provider_subscription ps
       JOIN subscription s ON s.id=ps.subscription_id
       WHERE ps.provider=? AND ps.provider_subscription_reference=?`,
    )
    .bind(event.provider, event.providerReference)
    .first<{
      id: string;
      subscription_id: string;
      customer_id: string;
      provider_plan_reference: string;
      provider_customer_reference: string | null;
      provider_status: string;
      provider_observed_at: number;
      subscription_status: SubscriptionLifecycleState;
      subscription_version: number;
    }>();
  if (!mapping)
    return {
      processingStatus: "RECONCILIATION_REQUIRED",
      subscriptionId: null,
      errorCode: "SUBSCRIPTION_UNMAPPED",
    };
  if (
    mapping.provider_plan_reference !== event.providerPlanReference ||
    (mapping.provider_customer_reference &&
      mapping.provider_customer_reference !== event.providerCustomerReference)
  )
    return {
      processingStatus: "RECONCILIATION_REQUIRED",
      subscriptionId: mapping.subscription_id,
      errorCode: "SUBSCRIPTION_PROVIDER_IDENTITY_MISMATCH",
    };
  if (event.observedAt < mapping.provider_observed_at)
    return { processingStatus: "DUPLICATE", subscriptionId: mapping.subscription_id };

  const target = canonicalStatus(event.providerStatus);
  const current = mapping.subscription_status;
  if (current === "CANCELED" || current === "EXPIRED") {
    if (target !== current)
      return {
        processingStatus: "RECONCILIATION_REQUIRED",
        subscriptionId: mapping.subscription_id,
        errorCode: "TERMINAL_SUBSCRIPTION_DIVERGENCE",
      };
  }
  const transitionPath = findSubscriptionTransitionPath(current, target);
  if (transitionPath === null) {
    return {
      processingStatus: "RECONCILIATION_REQUIRED",
      subscriptionId: mapping.subscription_id,
      errorCode: "ILLEGAL_SUBSCRIPTION_TRANSITION",
    };
  }

  const details = JSON.stringify({
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerStatus: event.providerStatus,
    transitionPath,
  });
  const mappingUpdate = database
    .prepare(
      `UPDATE payment_provider_subscription
       SET provider_status=?, latest_provider_event_id=?, latest_invoice_reference=COALESCE(?, latest_invoice_reference),
           next_billing_at=?, provider_observed_at=?, updated_at=?
       WHERE id=? AND provider_observed_at<=?`,
    )
    .bind(
      event.providerStatus,
      event.providerEventId,
      event.latestInvoiceReference,
      event.nextBillingAt,
      event.observedAt,
      now,
      mapping.id,
      event.observedAt,
    );
  if (target === current) {
    const changed = await mappingUpdate.run().then((result) => result.meta?.changes ?? 0);
    return {
      processingStatus: changed === 1 ? "APPLIED" : "DUPLICATE",
      subscriptionId: mapping.subscription_id,
    };
  }
  const transitionSteps = transitionPath.slice(1);
  const statements: D1PreparedStatement[] = [];
  for (const [index, step] of transitionSteps.entries()) {
    const previous = transitionPath[index];
    const terminal = step === "CANCELED" || step === "EXPIRED";
    statements.push(
      database
        .prepare(
          `UPDATE subscription
         SET status=?, ended_at=?,
             current_period_starts_at=CASE WHEN ?='ACTIVE' AND status='PENDING' THEN ? ELSE current_period_starts_at END,
             current_period_ends_at=COALESCE(?, current_period_ends_at),
             cancel_at_period_end=0, scheduled_cancellation_at=NULL,
             version=version+1, updated_at=?
         WHERE id=? AND status=? AND version=?`,
        )
        .bind(
          step,
          terminal ? event.observedAt : null,
          step,
          event.observedAt,
          event.nextBillingAt,
          now,
          mapping.subscription_id,
          previous,
          mapping.subscription_version + index,
        ),
      database
        .prepare(
          `INSERT INTO subscription_event
           (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at)
         SELECT ?, ?, 'PROVIDER_STATE_OBSERVED', 'PROVIDER', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM subscription WHERE id=? AND status=? AND version=?)`,
        )
        .bind(
          crypto.randomUUID(),
          mapping.subscription_id,
          details,
          event.observedAt,
          now,
          mapping.subscription_id,
          step,
          mapping.subscription_version + index + 1,
        ),
    );
  }
  statements.push(mappingUpdate);
  const outcomes = await database.batch(statements);
  if (outcomes.some((outcome) => (outcome.meta?.changes ?? 0) !== 1))
    return {
      processingStatus: "RETRY_REQUIRED",
      subscriptionId: mapping.subscription_id,
      errorCode: "VERSION_CONFLICT",
    };
  return { processingStatus: "APPLIED", subscriptionId: mapping.subscription_id };
}

export async function applySubscriptionInvoiceProviderEvent(
  database: D1Database,
  event: VerifiedSubscriptionInvoiceProviderEvent,
  now: number,
): Promise<SubscriptionProviderApplication> {
  const mapping = await database
    .prepare(
      `SELECT subscription_id FROM payment_provider_subscription
       WHERE provider=? AND provider_subscription_reference=?`,
    )
    .bind(event.provider, event.providerSubscriptionReference)
    .first<{ subscription_id: string }>();
  if (!mapping)
    return {
      processingStatus: "RECONCILIATION_REQUIRED",
      subscriptionId: null,
      errorCode: "INVOICE_SUBSCRIPTION_UNMAPPED",
    };
  const existing = await database
    .prepare(
      `SELECT id, provider_observed_at FROM payment_provider_subscription_invoice
       WHERE provider=? AND provider_invoice_reference=?`,
    )
    .bind(event.provider, event.providerReference)
    .first<{ id: string; provider_observed_at: number }>();
  if (existing && event.observedAt < existing.provider_observed_at)
    return { processingStatus: "DUPLICATE", subscriptionId: mapping.subscription_id };
  const outcome = await database
    .prepare(
      `INSERT INTO payment_provider_subscription_invoice
         (id, provider, provider_invoice_reference, provider_subscription_reference,
          provider_payment_reference, provider_status, amount_minor, currency, due_at, paid_at,
          latest_provider_event_id, provider_observed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_invoice_reference) DO UPDATE SET
         provider_payment_reference=COALESCE(excluded.provider_payment_reference, provider_payment_reference),
         provider_status=excluded.provider_status,
         amount_minor=excluded.amount_minor,
         currency=excluded.currency,
         due_at=excluded.due_at,
         paid_at=COALESCE(excluded.paid_at, paid_at),
         latest_provider_event_id=excluded.latest_provider_event_id,
         provider_observed_at=excluded.provider_observed_at,
         updated_at=excluded.updated_at
       WHERE excluded.provider_observed_at>=provider_observed_at`,
    )
    .bind(
      existing?.id ?? crypto.randomUUID(),
      event.provider,
      event.providerReference,
      event.providerSubscriptionReference,
      event.providerPaymentReference,
      event.providerStatus,
      event.amountMinor,
      event.currency,
      event.dueAt,
      event.paidAt,
      event.providerEventId,
      event.observedAt,
      now,
      now,
    )
    .run();
  return {
    processingStatus: (outcome.meta?.changes ?? 0) === 1 ? "APPLIED" : "DUPLICATE",
    subscriptionId: mapping.subscription_id,
  };
}
