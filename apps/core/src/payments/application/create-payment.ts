import { requestHash } from "../../idempotency";
import type { PaymentPurpose } from "../domain/payment";
import {
  createPaymentRepository,
  type PaymentRepository,
} from "../infrastructure/d1/payment-repository";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { recordFinancialEvent } from "./financial-observability";

export type CreatePaymentCommand = {
  purpose: PaymentPurpose;
  subjectType: string;
  subjectId: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  providerCode?: string;
  returnUrl: string;
  idempotencyKey: string;
  requestId: string;
};

export type CreatedPaymentAction = {
  paymentIntentId: string;
  state: "INITIATED" | "REQUIRES_ACTION" | "PROCESSING" | "FAILED";
  actionType: "NONE" | "REDIRECT" | "SDK";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: string | null;
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Create (or replay) one payment intent for a purpose. The application intent
 * persists before the provider is contacted; a provider response never maps to
 * canonical `SUCCEEDED`. If the provider accepts but local persistence fails,
 * a reconciliation case records the provider reference for manual/automatic
 * recovery instead of losing the linkage.
 */
export async function createPayment(
  database: D1Database,
  registry: ProviderRegistry,
  command: CreatePaymentCommand,
): Promise<
  { ok: true; value: CreatedPaymentAction; requestId: string } | ReturnType<typeof failure>
> {
  if (!Number.isInteger(command.amountMinor) || command.amountMinor <= 0)
    return failure(
      "VALIDATION_FAILED",
      "Payment amount must be a positive integer minor unit",
      command.requestId,
    );
  if (!command.currency || command.currency.trim() === "")
    return failure("VALIDATION_FAILED", "Currency is required", command.requestId);
  const repository: PaymentRepository = createPaymentRepository(database);

  const hash = await requestHash({
    purpose: command.purpose,
    subjectType: command.subjectType,
    subjectId: command.subjectId,
    customerId: command.customerId,
    amountMinor: command.amountMinor,
    currency: command.currency,
  });

  const existing = await repository.findIntentByIdempotencyKey(command.idempotencyKey);
  if (existing) {
    if (
      existing.purpose !== command.purpose ||
      existing.subjectType !== command.subjectType ||
      existing.subjectId !== command.subjectId ||
      existing.customerId !== command.customerId ||
      existing.amountMinor !== command.amountMinor ||
      existing.currency !== command.currency
    )
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different payment",
        command.requestId,
      );
    const state = toActionState(existing.status);
    const action =
      state === "REQUIRES_ACTION"
        ? await repository.findActiveProviderAction(existing.id, Date.now())
        : null;
    if (state === "REQUIRES_ACTION" && !action) {
      recordFinancialEvent({
        event: "payment_action_expired",
        requestId: command.requestId,
        scope: "payments.create",
        aggregateId: existing.id,
        outcomeCode: "PAYMENT_ACTION_EXPIRED",
      });
      return failure(
        "PAYMENT_ACTION_EXPIRED",
        "The payment continuation expired; start a new payment command",
        command.requestId,
      );
    }
    recordFinancialEvent({
      event: "payment_command_replayed",
      requestId: command.requestId,
      scope: "payments.create",
      aggregateId: existing.id,
      outcomeCode: existing.status,
    });
    return {
      ok: true,
      value: {
        paymentIntentId: existing.id,
        state,
        actionType: action?.actionType ?? "NONE",
        redirectUrl: action?.redirectUrl ?? null,
        clientToken: action?.clientToken ?? null,
        expiresAt: action ? new Date(action.expiresAt).toISOString() : null,
      },
      requestId: command.requestId,
    };
  }

  const intentId = crypto.randomUUID();
  const now = Date.now();
  try {
    await database
      .prepare(
        "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'INITIATED', ?, 1, ?, ?)",
      )
      .bind(
        intentId,
        command.purpose,
        command.subjectType,
        command.subjectId,
        command.customerId,
        command.amountMinor,
        command.currency,
        command.idempotencyKey,
        now,
        now,
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      return failure(
        "CONFLICT",
        "The original payment command is still processing",
        command.requestId,
      );
    }
    throw error;
  }

  const providerCode = command.providerCode ?? "";
  let provider;
  try {
    provider = registry.require(providerCode);
  } catch {
    await database
      .prepare(
        "UPDATE payment_intent SET status='FAILED', version=version+1, updated_at=? WHERE id=? AND status='INITIATED'",
      )
      .bind(Date.now(), intentId)
      .run();
    return failure(
      "CONFIGURATION_ERROR",
      `No payment provider is configured for '${providerCode}'`,
      command.requestId,
    );
  }

  const providerCustomerRef =
    (await repository.findProviderCustomer(command.customerId, provider.code)) ??
    `${provider.code}_cust_${command.customerId}`;
  try {
    await repository.upsertProviderCustomer({
      customerId: command.customerId,
      provider: provider.code,
      providerCustomerRef: providerCustomerRef,
      now: Date.now(),
    });
  } catch {
    await database
      .prepare(
        "UPDATE payment_intent SET status='FAILED', version=version+1, updated_at=? WHERE id=? AND status='INITIATED'",
      )
      .bind(Date.now(), intentId)
      .run();
    return failure(
      "CONFIGURATION_ERROR",
      "Customer payment identity belongs to a different provider",
      command.requestId,
    );
  }

  let providerResult;
  try {
    providerResult = await provider.createPayment({
      providerCustomerId: providerCustomerRef,
      amountMinor: command.amountMinor,
      currency: command.currency,
      returnUrl: command.returnUrl,
      idempotencyKey: command.idempotencyKey,
    });
  } catch (error) {
    await repository.recordReconciliationCase({
      intentId,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: provider.code,
        reason: error instanceof Error ? error.message : String(error),
      }),
      now: Date.now(),
    });
    recordFinancialEvent({
      event: "payment_outcome_unresolved",
      requestId: command.requestId,
      scope: "payments.create",
      provider: provider.code,
      aggregateId: intentId,
      outcomeCode: "PAYMENT_OUTCOME_UNRESOLVED",
    });
    return failure(
      "PAYMENT_OUTCOME_UNRESOLVED",
      "The provider outcome is unknown; reconciliation is required",
      command.requestId,
    );
  }

  if (!providerResult.ok) {
    await database
      .prepare(
        "UPDATE payment_intent SET status='FAILED', version=version+1, updated_at=? WHERE id=? AND status='INITIATED'",
      )
      .bind(Date.now(), intentId)
      .run();
    return failure(
      "PAYMENT_FAILED",
      `Provider error: ${providerResult.errorCode}`,
      command.requestId,
    );
  }

  const nextState = providerResult.actionType === "NONE" ? "PROCESSING" : "REQUIRES_ACTION";
  if (
    providerResult.actionType !== "NONE" &&
    (!providerResult.expiresAt ||
      providerResult.expiresAt <= Date.now() ||
      (providerResult.actionType === "REDIRECT" && !providerResult.redirectUrl) ||
      (providerResult.actionType === "SDK" && !providerResult.clientToken))
  ) {
    await repository.recordReconciliationCase({
      intentId,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: provider.code,
        providerReference: providerResult.providerReference,
        reason: "INVALID_PROVIDER_ACTION",
      }),
      now: Date.now(),
    });
    return failure(
      "PAYMENT_OUTCOME_UNRESOLVED",
      "The provider returned an unusable continuation; reconciliation is required",
      command.requestId,
    );
  }
  try {
    const persistedAt = Date.now();
    const statements = [
      repository.recordAttempt({
        attemptId: crypto.randomUUID(),
        intentId,
        customerId: command.customerId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        status: nextState,
        provider: provider.code,
        providerReference: providerResult.providerReference,
        now: persistedAt,
      }),
      repository.updateIntentStatusCas({
        intentId,
        expectedVersion: 1,
        fromStatus: "INITIATED",
        toStatus: nextState,
        now: persistedAt,
      }),
    ];
    if (providerResult.actionType !== "NONE")
      statements.push(
        repository.recordProviderActionStatement({
          paymentIntentId: intentId,
          provider: provider.code,
          providerReference: providerResult.providerReference,
          actionType: providerResult.actionType,
          redirectUrl: providerResult.redirectUrl,
          clientToken: providerResult.clientToken,
          expiresAt: providerResult.expiresAt!,
          now: persistedAt,
        }),
      );
    await database.batch(statements);
  } catch (error) {
    await repository.recordReconciliationCase({
      intentId,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: provider.code,
        providerReference: providerResult.providerReference,
        reason: error instanceof Error ? error.message : String(error),
      }),
      now: Date.now(),
    });
    recordFinancialEvent({
      event: "payment_outcome_unresolved",
      requestId: command.requestId,
      scope: "payments.persist",
      provider: provider.code,
      aggregateId: intentId,
      outcomeCode: "PAYMENT_OUTCOME_UNRESOLVED",
    });
    return failure(
      "PAYMENT_OUTCOME_UNRESOLVED",
      "Payment created but persistence is unresolved; reconciliation is required",
      command.requestId,
    );
  }

  void hash;
  return {
    ok: true,
    value: {
      paymentIntentId: intentId,
      state: nextState,
      actionType: providerResult.actionType,
      redirectUrl: providerResult.redirectUrl,
      clientToken: providerResult.clientToken,
      expiresAt: providerResult.expiresAt
        ? new Date(providerResult.expiresAt).toISOString()
        : null,
    },
    requestId: command.requestId,
  };
}

function toActionState(status: string): CreatedPaymentAction["state"] {
  switch (status) {
    case "REQUIRES_ACTION":
    case "PROCESSING":
    case "FAILED":
    case "INITIATED":
      return status;
    default:
      return "PROCESSING";
  }
}
