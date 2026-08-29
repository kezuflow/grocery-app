import { requestHash } from "../../idempotency";
import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";

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
  expiresAt: number | null;
};

const SCOPE = "payments.beginRecurringAuthorization";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Begin establishing a recurring-capable payment authorization. The persisted
 * row stays PENDING until the provider confirms a mandate; establishing the
 * authorization is never payment success and never synthesizes a charge.
 */
export async function beginRecurringAuthorization(
  database: D1Database,
  registry: ProviderRegistry,
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
      if (row) return { ok: true, value: replayValue(row), requestId: command.requestId };
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

  const result = await provider.createAuthorization({
    providerCustomerId: providerCustomerRef,
    currency: command.currency,
    idempotencyKey: command.idempotencyKey,
    returnUrl: command.returnUrl,
  });
  if (!result.ok)
    return failure(
      "AUTHORIZATION_FAILED",
      `Provider error: ${result.errorCode}`,
      command.requestId,
    );

  const authorizationId = crypto.randomUUID();
  const now = Date.now();
  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES (?, ?, ?, 'payment_authorization', ?, 'PROCESSING', ?, ?)",
        )
        .bind(SCOPE, command.idempotencyKey, hash, authorizationId, now, now),
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
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(now, SCOPE, command.idempotencyKey),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("payment_authorization"))
      return failure(
        "CONFLICT",
        "This provider authorization session is already recorded",
        command.requestId,
      );
    throw error;
  }

  return {
    ok: true,
    value: {
      authorizationId,
      provider: provider.code,
      actionType: result.action.actionType,
      redirectUrl: result.action.redirectUrl,
      clientToken: result.action.clientToken,
      expiresAt: result.action.expiresAt,
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

function replayValue(row: AuthorizationRow): BeginRecurringAuthorizationResult {
  return {
    authorizationId: row.id,
    provider: row.provider,
    actionType: "NONE",
    redirectUrl: null,
    clientToken: null,
    expiresAt: null,
  };
}
