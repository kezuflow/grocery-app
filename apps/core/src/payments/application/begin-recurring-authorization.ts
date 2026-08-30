import { requestHash } from "../../idempotency";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";
import { recordFinancialEvent } from "./financial-observability";

export type BeginRecurringAuthorizationCommand = {
  customerId: string;
  providerCode: string;
  currency: string;
  returnUrl: string;
  idempotencyKey: string;
  requestId: string;
};

export type BeginRecurringAuthorizationResult = {
  authorizationId: string;
  provider: string;
  actionType: "REDIRECT" | "SDK" | "NONE";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: string | null;
};

const SCOPE = "payments.beginRecurringAuthorization";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Begin establishing a recurring-capable payment authorization. The persisted
 * row stays PENDING until the provider confirms a mandate; establishing the
 * authorization is never payment success and never synthesizes a charge.
 */
export async function beginRecurringAuthorization(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: BeginRecurringAuthorizationCommand,
): Promise<
  | { ok: true; value: BeginRecurringAuthorizationResult; requestId: string }
  | ReturnType<typeof failure>
> {
  if (!command.currency || command.currency.trim() === "")
    return failure("VALIDATION_FAILED", "Currency is required", command.requestId);
  if (!command.returnUrl || command.returnUrl.trim() === "")
    return failure("VALIDATION_FAILED", "Return URL is required", command.requestId);

  const hash = await requestHash({
    customerId: command.customerId,
    providerCode: command.providerCode,
    currency: command.currency,
  });

  const existing = await database
    .prepare(
      "SELECT request_hash, status, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(SCOPE, command.idempotencyKey)
    .first<{ request_hash: string; status: string; result_reference: string | null }>();
  if (existing) {
    if (existing.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (existing.status === "SUCCEEDED" && existing.result_reference) {
      const row = await findAuthorization(database, existing.result_reference);
      if (row) {
        const repository = createPaymentRepository(database);
        const action = await repository.findActiveAuthorizationAction(row.id, Date.now());
        if (!action && (await repository.hasAuthorizationProviderAction(row.id))) {
          recordFinancialEvent({
            event: "authorization_action_expired",
            requestId: command.requestId,
            scope: "authorizations.begin",
            provider: row.provider,
            aggregateId: row.id,
            outcomeCode: "AUTHORIZATION_ACTION_EXPIRED",
          });
          return failure(
            "AUTHORIZATION_ACTION_EXPIRED",
            "The authorization continuation expired; start a new command",
            command.requestId,
          );
        }
        recordFinancialEvent({
          event: "authorization_command_replayed",
          requestId: command.requestId,
          scope: "authorizations.begin",
          provider: row.provider,
          aggregateId: row.id,
          outcomeCode: row.status,
        });
        return {
          ok: true,
          value: replayValue(row, action),
          requestId: command.requestId,
        };
      }
    }
    return failure(
      "CONFLICT",
      existing.status === "FAILED"
        ? "The original authorization command failed; retry with a new idempotency key"
        : "The original authorization command is still processing",
      command.requestId,
    );
  }

  let provider;
  try {
    provider = registry.require(command.providerCode);
  } catch {
    return failure(
      "CONFIGURATION_ERROR",
      `No payment provider is configured for '${command.providerCode}'`,
      command.requestId,
    );
  }

  const repository = createPaymentRepository(database);
  const providerCustomerRef =
    (await repository.findProviderCustomer(command.customerId, provider.code)) ??
    `${provider.code}_cust_${command.customerId}`;
  try {
    await repository.upsertProviderCustomer({
      customerId: command.customerId,
      provider: provider.code,
      providerCustomerRef,
      now: Date.now(),
    });
  } catch {
    return failure(
      "CONFIGURATION_ERROR",
      "Customer payment identity belongs to a different provider",
      command.requestId,
    );
  }

  const authorizationId = crypto.randomUUID();
  const claimedAt = Date.now();
  const claimed = await database
    .prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES (?, ?, ?, 'payment_authorization', ?, 'PROCESSING', ?, ?)",
    )
    .bind(SCOPE, command.idempotencyKey, hash, authorizationId, claimedAt, claimedAt)
    .run()
    .then((result) => (result.meta?.changes ?? 0) === 1);
  if (!claimed) {
    const concurrent = await database
      .prepare(
        "SELECT request_hash, status, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
      )
      .bind(SCOPE, command.idempotencyKey)
      .first<{ request_hash: string; status: string; result_reference: string | null }>();
    if (!concurrent || concurrent.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (concurrent.status === "SUCCEEDED" && concurrent.result_reference) {
      const row = await findAuthorization(database, concurrent.result_reference);
      if (row) {
        const action = await repository.findActiveAuthorizationAction(row.id, Date.now());
        return {
          ok: true,
          value: replayValue(row, action),
          requestId: command.requestId,
        };
      }
    }
    return failure(
      "CONFLICT",
      "The original authorization command is still processing",
      command.requestId,
    );
  }

  let result;
  try {
    result = await provider.createAuthorization({
      providerCustomerId: providerCustomerRef,
      currency: command.currency,
      idempotencyKey: command.idempotencyKey,
      returnUrl: command.returnUrl,
    });
  } catch (error) {
    await repository.recordReconciliationCase({
      intentId: null,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        authorizationId,
        provider: provider.code,
        reason: error instanceof Error ? error.message : String(error),
      }),
      now: Date.now(),
    });
    recordFinancialEvent({
      event: "authorization_outcome_unresolved",
      requestId: command.requestId,
      scope: "authorizations.begin",
      provider: provider.code,
      aggregateId: authorizationId,
      outcomeCode: "AUTHORIZATION_OUTCOME_UNRESOLVED",
    });
    return failure(
      "AUTHORIZATION_OUTCOME_UNRESOLVED",
      "The provider outcome is unknown; reconciliation is required",
      command.requestId,
    );
  }
  if (!result.ok) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure(
      "AUTHORIZATION_FAILED",
      `Provider error: ${result.errorCode}`,
      command.requestId,
    );
  }

  const now = Date.now();
  if (
    result.action.actionType !== "NONE" &&
    (!result.action.expiresAt ||
      result.action.expiresAt <= now ||
      (result.action.actionType === "REDIRECT" && !result.action.redirectUrl) ||
      (result.action.actionType === "SDK" && !result.action.clientToken))
  ) {
    await repository.recordReconciliationCase({
      intentId: null,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        authorizationId,
        provider: provider.code,
        providerReference: result.action.providerAuthorizationReference,
        reason: "INVALID_PROVIDER_ACTION",
      }),
      now,
    });
    return failure(
      "AUTHORIZATION_OUTCOME_UNRESOLVED",
      "The provider returned an unusable continuation; reconciliation is required",
      command.requestId,
    );
  }
  try {
    const statements = [
      database
        .prepare(
          "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, recurring_capable, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'PENDING', ?, ?)",
        )
        .bind(
          authorizationId,
          command.customerId,
          provider.code,
          result.action.providerAuthorizationReference,
          now,
          now,
        ),
    ];
    if (result.action.actionType !== "NONE")
      statements.push(
        repository.recordAuthorizationActionStatement({
          authorizationId,
          provider: provider.code,
          providerReference: result.action.providerAuthorizationReference,
          actionType: result.action.actionType,
          redirectUrl: result.action.redirectUrl,
          clientToken: result.action.clientToken,
          expiresAt: result.action.expiresAt!,
          now,
        }),
      );
    statements.push(
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(now, SCOPE, command.idempotencyKey),
    );
    await database.batch(statements);
  } catch (error) {
    await repository.recordReconciliationCase({
      intentId: null,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        authorizationId,
        provider: provider.code,
        providerReference: result.action.providerAuthorizationReference,
        reason: error instanceof Error ? error.message : String(error),
      }),
      now: Date.now(),
    });
    recordFinancialEvent({
      event: "authorization_outcome_unresolved",
      requestId: command.requestId,
      scope: "authorizations.persist",
      provider: provider.code,
      aggregateId: authorizationId,
      outcomeCode: "AUTHORIZATION_OUTCOME_UNRESOLVED",
    });
    return failure(
      "AUTHORIZATION_OUTCOME_UNRESOLVED",
      "Authorization persistence is unresolved; reconciliation is required",
      command.requestId,
    );
  }

  return {
    ok: true,
    value: {
      authorizationId,
      provider: provider.code,
      actionType: result.action.actionType,
      redirectUrl: result.action.redirectUrl,
      clientToken: result.action.clientToken,
      expiresAt: result.action.expiresAt ? new Date(result.action.expiresAt).toISOString() : null,
    },
    requestId: command.requestId,
  };
}

type AuthorizationRow = {
  id: string;
  provider: string;
  provider_authorization_ref: string;
  status: string;
};

async function findAuthorization(
  database: D1Database,
  id: string,
): Promise<AuthorizationRow | null> {
  return database
    .prepare(
      "SELECT id, provider, provider_authorization_ref, status FROM payment_authorization WHERE id=?",
    )
    .bind(id)
    .first<AuthorizationRow>();
}

function replayValue(
  row: AuthorizationRow,
  action: Awaited<
    ReturnType<ReturnType<typeof createPaymentRepository>["findActiveAuthorizationAction"]>
  >,
): BeginRecurringAuthorizationResult {
  return {
    authorizationId: row.id,
    provider: row.provider,
    actionType: action?.actionType ?? "NONE",
    redirectUrl: action?.redirectUrl ?? null,
    clientToken: action?.clientToken ?? null,
    expiresAt: action ? new Date(action.expiresAt).toISOString() : null,
  };
}
