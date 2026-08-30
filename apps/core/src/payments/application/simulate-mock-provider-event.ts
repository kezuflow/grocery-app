import type {
  MockPaymentOutcome,
  MockPaymentSimulationView,
  RpcResult,
} from "@freshmarkets/contracts";
import type { RuntimeEnvironment } from "../../runtime/runtime-configuration";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { ingestProviderEvent } from "./ingest-provider-event";

const SCOPE = "payments.simulateMockProviderEvent";

type Command = {
  environment: RuntimeEnvironment;
  customerId: string;
  providerReference: string;
  outcome: MockPaymentOutcome;
  idempotencyKey: string;
  requestId: string;
};

function failure(
  code: "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "CONFLICT" | "PAYMENT_PROVIDER_UNAVAILABLE",
  message: string,
  requestId: string,
): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}

function parseResult(value: string | null): MockPaymentSimulationView | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as MockPaymentSimulationView;
  } catch {
    return null;
  }
}

export async function simulateMockProviderEvent(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: Command,
): Promise<RpcResult<MockPaymentSimulationView>> {
  if (command.environment !== "development" && command.environment !== "test")
    return failure("NOT_FOUND", "Payment simulator not found", command.requestId);

  const repository = extendPaymentRepository(database);
  const intents = await repository.findIntentByProviderReference("mock", command.providerReference);
  if (intents.length !== 1 || intents[0].customerId !== command.customerId)
    return failure("NOT_FOUND", "Payment simulator not found", command.requestId);
  const intent = intents[0];
  const payload = {
    customerId: command.customerId,
    providerReference: command.providerReference,
    outcome: command.outcome,
  };
  const existing = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== (await requestHash(payload)))
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "That simulator key was already used for another outcome",
        command.requestId,
      );
    const replay = parseResult(existing.resultReference);
    if (existing.status === "SUCCEEDED" && replay)
      return { ok: true, value: replay, requestId: command.requestId };
    if (existing.status === "PROCESSING")
      return failure("CONFLICT", "Payment simulation is already processing", command.requestId);
  }

  const claim = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    payload,
  );
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Simulator key conflict", command.requestId);
    const replay = parseResult(claim.existing?.resultReference ?? null);
    if (claim.existing?.status === "SUCCEEDED" && replay)
      return { ok: true, value: replay, requestId: command.requestId };
    return failure("CONFLICT", "Payment simulation is already processing", command.requestId);
  }

  let provider;
  try {
    provider = registry.require("mock");
  } catch {
    provider = null;
  }
  if (!provider?.createTestEvent) {
    await markFailed(database, command.idempotencyKey, claim.hash);
    return failure(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "The local mock provider is unavailable",
      command.requestId,
    );
  }

  const observedAt = Date.now();
  const signed = await provider.createTestEvent({
    providerEventId: `mock-simulator-${claim.hash.slice(0, 32)}`,
    providerReference: command.providerReference,
    outcome: command.outcome,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    observedAt,
  });
  const ingested = await ingestProviderEvent(
    database,
    registry,
    "mock",
    signed.headers,
    signed.rawBody,
    command.requestId,
  );
  if (!ingested.ok) {
    await markFailed(database, command.idempotencyKey, claim.hash);
    return failure("CONFLICT", "The simulated provider event was rejected", command.requestId);
  }

  const order = await database
    .prepare("SELECT order_id FROM order_payment_reaction WHERE payment_intent_id=?")
    .bind(intent.id)
    .first<{ order_id: string }>();
  const value: MockPaymentSimulationView = {
    providerReference: command.providerReference,
    outcome: command.outcome,
    processingStatus: ingested.value.processingStatus,
    paymentIntentId: intent.id,
    committedOrderId: order?.order_id ?? null,
  };
  await database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(JSON.stringify(value), Date.now(), SCOPE, command.idempotencyKey, claim.hash)
    .run();
  return { ok: true, value, requestId: command.requestId };
}

function markFailed(database: D1Database, key: string, hash: string): Promise<void> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(Date.now(), SCOPE, key, hash)
    .run()
    .then(() => undefined);
}
