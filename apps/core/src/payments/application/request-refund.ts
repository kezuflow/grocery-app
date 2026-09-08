import type { RefundRow } from "../infrastructure/d1/payment-repository";
import { extendPaymentRepositoryForRefunds } from "../infrastructure/d1/payment-repository";

type RefundRowLike = Omit<RefundRow, "providerRefundReference">;
import type { PaymentProvider } from "../ports/payment-provider";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { recordFinancialEvent } from "./financial-observability";

export type RequestRefundCommand = {
  paymentIntentId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type RefundView = {
  refundId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  state:
    | "REQUESTED"
    | "APPROVED"
    | "PROCESSING"
    | "SUCCEEDED"
    | "REJECTED"
    | "FAILED"
    | "ESCALATED";
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Request a refund against a captured payment. The refund identity persists
 * before any provider side effect, and this command never writes
 * `SUCCEEDED`: only a verified provider observation (event or reconciliation)
 * may complete a refund.
 */
export async function requestRefund(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: RequestRefundCommand,
): Promise<{ ok: true; value: RefundView; requestId: string } | ReturnType<typeof failure>> {
  const repository = extendPaymentRepositoryForRefunds(database);
  const intent = await repository.findIntentById(command.paymentIntentId);
  if (!intent) return failure("NOT_FOUND", "Payment intent not found", command.requestId);
  if (!Number.isInteger(command.amountMinor) || command.amountMinor <= 0)
    return failure(
      "VALIDATION_FAILED",
      "Refund amount must be a positive integer minor unit",
      command.requestId,
    );

  const replay = await repository.findRefundByIdempotencyKey(command.idempotencyKey);
  if (replay) {
    if (replay.paymentIntentId !== intent.id || replay.amountMinor !== command.amountMinor)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different refund",
        command.requestId,
      );
    if (replay.status !== "REQUESTED")
      return { ok: true, value: toView(replay), requestId: command.requestId };
  }
  if (!replay && !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(intent.status))
    return failure(
      "ILLEGAL_TRANSITION",
      "Only captured payments can be refunded",
      command.requestId,
    );

  const now = Date.now();
  // Resolve the provider seam before reserving refundable value. A surviving
  // REQUESTED refund remains pending evidence; if its seam disappeared,
  // escalate it instead of leaving budget silently claimed.
  const attempt = await database
    .prepare(
      "SELECT provider, provider_reference FROM payment_attempt WHERE payment_intent_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(intent.id)
    .first<{ provider: string; provider_reference: string }>();
  if (!attempt) {
    if (replay)
      await escalateRequestedRefund(
        database,
        repository,
        replay.id,
        replay.version,
        intent.id,
        "PROVIDER_ATTEMPT_MISSING",
        now,
      );
    return failure(
      "CONFIGURATION_ERROR",
      "No provider attempt is linked to this payment",
      command.requestId,
    );
  }
  let provider;
  try {
    provider = registry.require(attempt.provider);
  } catch {
    if (replay)
      await escalateRequestedRefund(
        database,
        repository,
        replay.id,
        replay.version,
        intent.id,
        "PAYMENT_PROVIDER_UNCONFIGURED",
        now,
      );
    return failure(
      "PAYMENT_PROVIDER_UNCONFIGURED",
      "The captured payment provider is not configured",
      command.requestId,
    );
  }

  const refundId = replay?.id ?? crypto.randomUUID();
  const requestedVersion = replay?.version ?? 1;
  // A surviving REQUESTED identity may already have reached the provider.
  // Only the first budget claimant submits; later callers expose pending
  // evidence for reconciliation instead of issuing a concurrent second request.
  if (replay) return { ok: true, value: toView(replay), requestId: command.requestId };
  if (!replay) {
    const claimed = await repository.claimRefundBudget({
      refundId,
      intentId: intent.id,
      amountMinor: command.amountMinor,
      reason: command.reason,
      idempotencyKey: command.idempotencyKey,
      now,
    });
    if (!claimed) {
      const concurrentReplay = await repository.findRefundByIdempotencyKey(command.idempotencyKey);
      if (concurrentReplay)
        return { ok: true, value: toView(concurrentReplay), requestId: command.requestId };
      recordFinancialEvent({
        event: "refund_budget_rejected",
        requestId: command.requestId,
        scope: "refunds.request",
        aggregateId: intent.id,
        outcomeCode: "REFUND_AMOUNT_UNAVAILABLE",
      });
      return failure(
        "REFUND_AMOUNT_UNAVAILABLE",
        "Refund exceeds the currently refundable captured amount",
        command.requestId,
      );
    }
  }

  return submitClaimedRefund(database, provider, {
    refundId,
    requestedVersion,
    paymentIntentId: intent.id,
    currency: intent.currency,
    providerCode: attempt.provider,
    providerReference: attempt.provider_reference,
    amountMinor: command.amountMinor,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
    now,
  });
}

/** Only the command that created the durable Refund identity may submit it. */
export async function submitClaimedRefund(
  database: D1Database,
  provider: Pick<PaymentProvider, "requestRefund">,
  input: {
    refundId: string;
    requestedVersion: number;
    paymentIntentId: string;
    currency: string;
    providerCode: string;
    providerReference: string;
    amountMinor: number;
    idempotencyKey: string;
    requestId: string;
    now: number;
  },
): Promise<{ ok: true; value: RefundView; requestId: string } | ReturnType<typeof failure>> {
  const repository = extendPaymentRepositoryForRefunds(database),
    { refundId, requestedVersion, now } = input;

  try {
    const outcome = await provider.requestRefund({
      providerReference: input.providerReference,
      refundProviderIdempotencyKey: input.idempotencyKey,
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
    if (!outcome.ok) {
      await repository.updateRefundStatusCas({
        refundId,
        expectedVersion: requestedVersion,
        fromStatus: "REQUESTED",
        toStatus: "REJECTED",
        now,
      });
      return failure(
        "PAYMENT_FAILED",
        `Provider rejected the refund: ${outcome.errorCode}`,
        input.requestId,
      );
    }
    const processing = await repository.updateRefundStatusCas({
      refundId,
      expectedVersion: requestedVersion,
      fromStatus: "REQUESTED",
      toStatus: "PROCESSING",
      providerRefundReference: outcome.providerRefundReference,
      now,
    });
    if (processing !== 1) throw new Error("REFUND_STATUS_CONFLICT");
    const stored = await repository.findRefundByIdempotencyKey(input.idempotencyKey);
    if (!stored) throw new Error("REFUND_LOST");
    return {
      ok: true,
      value: toView({ ...stored, status: stored.status as RefundView["state"] }),
      requestId: input.requestId,
    };
  } catch (error) {
    // Ambiguous failure: keep the identity and record reconciliation instead of
    // retrying with a new identity.
    await repository.updateRefundStatusCas({
      refundId,
      expectedVersion: requestedVersion,
      fromStatus: "REQUESTED",
      toStatus: "ESCALATED",
      now: Date.now(),
    });
    await repository.recordReconciliationCase({
      intentId: input.paymentIntentId,
      category: "REFUND_UNRESOLVED",
      detailsJson: JSON.stringify({
        refundId,
        reason: error instanceof Error ? error.message : String(error),
      }),
      now,
    });
    recordFinancialEvent({
      event: "refund_outcome_unresolved",
      requestId: input.requestId,
      scope: "refunds.request",
      provider: input.providerCode,
      aggregateId: refundId,
      outcomeCode: "REFUND_UNRESOLVED",
    });
    return failure(
      "CONFLICT",
      "Refund request is unresolved; reconciliation required",
      input.requestId,
    );
  }
}

async function escalateRequestedRefund(
  database: D1Database,
  repository: ReturnType<typeof extendPaymentRepositoryForRefunds>,
  refundId: string,
  expectedVersion: number,
  intentId: string,
  reason: string,
  now: number,
): Promise<void> {
  await repository.updateRefundStatusCas({
    refundId,
    expectedVersion,
    fromStatus: "REQUESTED",
    toStatus: "ESCALATED",
    now,
  });
  await repository.recordReconciliationCase({
    intentId,
    category: "REFUND_UNRESOLVED",
    detailsJson: JSON.stringify({ refundId, reason }),
    now,
  });
}

function toView(row: RefundRowLike): RefundView {
  return {
    refundId: row.id,
    paymentIntentId: row.paymentIntentId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    state: row.status as RefundView["state"],
  };
}
