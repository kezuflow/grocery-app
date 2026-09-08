import { recordPaymentCreation, recoverPaymentCreation } from "./recover-payment-creation";
import { requestHash } from "../../idempotency";
import type { AppErrorCode } from "@freshmarkets/contracts";
import type { PaymentPurpose } from "../domain/payment";
import {
  createPaymentRepository,
  type PaymentRepository,
} from "../infrastructure/d1/payment-repository";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
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
  /** Trusted checkout command evidence; never accepted from a client payload. */
  checkoutVersion?: number;
};

export type CreatedPaymentAction = {
  paymentIntentId: string;
  state: "INITIATED" | "REQUIRES_ACTION" | "PROCESSING" | "FAILED";
  actionType: "NONE" | "REDIRECT" | "SDK";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: string | null;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Create (or replay) one payment intent for a purpose. The application intent
 * persists before the provider is contacted; a provider response never maps to
 * canonical `SUCCEEDED`. If the provider accepts but local persistence fails,
 * its durable private creation observation permits guarded local adoption without
 * another provider submission. Unknown external responses remain reconciliation cases.
 */
export async function createPayment(
  database: D1Database,
  registry: PaymentProviderRegistry,
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

  let existing = await repository.findIntentByIdempotencyKey(command.idempotencyKey);
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
    await recoverPaymentCreation(database, existing.id);
    existing = await repository.findIntentByIdempotencyKey(command.idempotencyKey);
    if (!existing)
      return failure(
        "PAYMENT_OUTCOME_UNRESOLVED",
        "Payment identity needs reconciliation",
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
    const insertIntent = database
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
      );
    const guards: D1PreparedStatement[] = [];
    if (command.checkoutVersion !== undefined)
      guards.push(
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -27 WHERE NOT EXISTS (
      SELECT 1 FROM checkout_quote q
      JOIN fulfillment_location l ON l.id=json_extract(q.cycle_snapshot_json,'$.locationId')
      JOIN geography_configuration geography ON geography.market_id=l.market_id
      JOIN market market ON market.id=l.market_id AND market.status='active'
      JOIN delivery_zone zone ON zone.id=json_extract(q.cycle_snapshot_json,'$.zoneId') AND zone.status='active'
      JOIN service_area area ON area.id=zone.service_area_id AND area.market_id=market.id AND area.status='active'
      JOIN location_serviceability link ON link.location_id=l.id AND link.zone_id=zone.id AND link.eligible=1
      JOIN global_commerce_configuration mode ON mode.id='global'
      JOIN customer customer ON customer.id=q.customer_id AND customer.status='active'
      WHERE q.id=? AND q.customer_id=? AND q.version=? AND q.status='ACTIVE' AND q.expires_at>?
        AND q.total_minor=? AND q.currency=? AND mode.selling_state='OPEN' AND mode.fulfillment_mode=q.fulfillment_mode
        AND geography.version=COALESCE(json_extract(q.cycle_snapshot_json,'$.geographyVersion'),1)
        AND l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT'
        AND l.version=COALESCE(json_extract(q.cycle_snapshot_json,'$.locationVersion'),l.version)
        AND link.valid_from<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND (link.valid_to IS NULL OR link.valid_to>CAST(unixepoch('subsec')*1000 AS INTEGER))
        AND area.active_from<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND (area.active_to IS NULL OR area.active_to>CAST(unixepoch('subsec')*1000 AS INTEGER))
        AND (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1 AND capability IN ('PICKING','PACKING','DISPATCH'))=3
        AND ((q.fulfillment_mode='INSTANT' AND EXISTS (SELECT 1 FROM fulfillment_location_readiness readiness WHERE readiness.location_id=l.id AND readiness.dispatch_ready=1
          AND readiness.version=COALESCE(json_extract(q.cycle_snapshot_json,'$.readinessVersion'),readiness.version)))
          OR (q.fulfillment_mode='SCHEDULED' AND EXISTS (SELECT 1 FROM delivery_cycle cycle JOIN delivery_cycle_zone participation ON participation.cycle_id=cycle.id
            WHERE cycle.id=q.delivery_cycle_id AND cycle.status='OPEN' AND cycle.cutoff_at>CAST(unixepoch('subsec')*1000 AS INTEGER)
              AND cycle.version=COALESCE(json_extract(q.cycle_snapshot_json,'$.cycleVersion'),cycle.version)
              AND participation.zone_id=zone.id AND participation.location_id=l.id AND participation.status='ACTIVE')))
    )`)
          .bind(
            command.subjectId,
            command.customerId,
            command.checkoutVersion,
            now,
            command.amountMinor,
            command.currency,
          ),
      );
    await database.batch([...guards, insertIntent]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/commitment_abort|CHECK constraint failed: id = 0/.test(message))
      return failure(
        "PRICE_CHANGED",
        "Checkout routing changed; accept a new quote",
        command.requestId,
      );
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

  let providerCustomerRef = await repository.findProviderCustomer(
    command.customerId,
    provider.code,
  );
  if (!providerCustomerRef && !provider.ensureCustomer) {
    providerCustomerRef = `${provider.code}_cust_${command.customerId}`;
    try {
      await repository.upsertProviderCustomer({
        customerId: command.customerId,
        provider: provider.code,
        providerCustomerRef,
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
  } catch {
    await repository.recordReconciliationCase({
      intentId,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: provider.code,
        reason: "PAYMENT_CREATION_OUTCOME_UNRESOLVED",
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
  try {
    await recordPaymentCreation(
      database,
      {
        intentId,
        provider: provider.code,
        purpose: command.purpose,
        subjectType: command.subjectType,
        subjectId: command.subjectId,
        customerId: command.customerId,
        amountMinor: command.amountMinor,
        currency: command.currency,
      },
      providerResult,
      Date.now(),
    );
    if (!(await recoverPaymentCreation(database, intentId)))
      throw new Error("PAYMENT_CREATION_ADOPTION_INCOMPLETE");
  } catch {
    await repository.recordReconciliationCase({
      intentId,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        provider: provider.code,
        providerReference: providerResult.providerReference,
        reason: "PAYMENT_CREATION_OUTCOME_UNRESOLVED",
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
  void hash;
  return {
    ok: true,
    value: {
      paymentIntentId: intentId,
      state: nextState,
      actionType: providerResult.actionType,
      redirectUrl: providerResult.redirectUrl,
      clientToken: providerResult.clientToken,
      expiresAt: providerResult.expiresAt ? new Date(providerResult.expiresAt).toISOString() : null,
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
