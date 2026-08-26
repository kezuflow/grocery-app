import { requestHash } from "../../idempotency";
import type { PaymentPurpose } from "../domain/payment";
import {
  createPaymentRepository,
  type PaymentRepository,
} from "../infrastructure/d1/payment-repository";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

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
  expiresAt: number | null;
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
    return {
      ok: true,
      value: {
        paymentIntentId: existing.id,
        state: toActionState(existing.status),
        actionType: actionStateToClientAction(toActionState(existing.status)),
        redirectUrl: null,
        clientToken: null,
        expiresAt: null,
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
  await repository.upsertProviderCustomer({
    customerId: command.customerId,
    provider: provider.code,
    providerCustomerRef: providerCustomerRef,
    now: Date.now(),
  });

  let providerResult;
  try {
    providerResult = await provider.createPayment({
      providerCustomerId: providerCustomerRef,
      amountMinor: command.amountMinor,
      currency: command.currency,
      returnUrl: command.returnUrl,
      idempotencyKey: command.idempotencyKey,
    });
  } catch {
    await database
      .prepare(
        "UPDATE payment_intent SET status='FAILED', version=version+1, updated_at=? WHERE id=? AND status='INITIATED'",
      )
      .bind(Date.now(), intentId)
      .run();
    return failure(
      "PAYMENT_FAILED",
      "The payment provider rejected the payment creation",
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
  try {
    await database.batch([
      repository.recordAttempt({
        attemptId: crypto.randomUUID(),
        intentId,
        customerId: command.customerId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        status: nextState,
        provider: provider.code,
        providerReference: providerResult.providerReference,
        now: Date.now(),
      }),
      repository.updateIntentStatusCas({
        intentId,
        expectedVersion: 1,
        fromStatus: "INITIATED",
        toStatus: nextState,
        now: Date.now(),
      }),
    ]);
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
    return failure(
      "CONFLICT",
      "Payment created but persistence failed; reconciliation required",
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
      expiresAt: providerResult.expiresAt,
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

function actionStateToClientAction(
  state: CreatedPaymentAction["state"],
): "NONE" | "REDIRECT" | "SDK" {
  return state === "REQUIRES_ACTION" ? "REDIRECT" : "NONE";
}
