import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";

export type CompleteRecurringAuthorizationCommand = {
  customerId: string;
  authorizationId: string;
  requestId: string;
};

export type CompletedRecurringAuthorization = {
  authorizationId: string;
  provider: string;
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Confirm a pending authorization from a verified provider lookup. Only a
 * provider-confirmed recurring-capable mandate with a stable method identity
 * becomes ACTIVE; anything else closes the attempt without ever pretending a
 * mandate exists.
 */
export async function completeRecurringAuthorization(
  database: D1Database,
  registry: ProviderRegistry,
  command: CompleteRecurringAuthorizationCommand,
): Promise<
  | { ok: true; value: CompletedRecurringAuthorization; requestId: string }
  | ReturnType<typeof failure>
> {
  const row = await database
    .prepare(
      "SELECT id, customer_id, provider, provider_authorization_ref, status FROM payment_authorization WHERE id=?",
    )
    .bind(command.authorizationId)
    .first<{
      id: string;
      customer_id: string;
      provider: string;
      provider_authorization_ref: string;
      status: string;
    }>();
  if (!row || row.customer_id !== command.customerId)
    return failure("NOT_FOUND", "Authorization not found", command.requestId);
  if (row.status === "ACTIVE")
    return {
      ok: true,
      value: { authorizationId: row.id, provider: row.provider },
      requestId: command.requestId,
    };
  if (row.status === "REVOKED")
    return failure(
      "AUTHORIZATION_REVOKED",
      "The authorization is no longer usable",
      command.requestId,
    );

  let provider;
  try {
    provider = registry.require(row.provider);
  } catch {
    return failure(
      "CONFIGURATION_ERROR",
      `No payment provider is configured for '${row.provider}'`,
      command.requestId,
    );
  }

  const result = await provider.getAuthorization(row.provider_authorization_ref);
  if (!result.ok)
    return failure(
      "PROVIDER_LOOKUP_FAILED",
      `Provider error: ${result.errorCode}`,
      command.requestId,
    );

  const now = Date.now();
  const authorization = result.authorization;
  if (authorization.status === "PENDING")
    return failure(
      "AUTHORIZATION_PENDING",
      "The customer has not finished authorizing the instrument",
      command.requestId,
    );
  if (authorization.status === "REVOKED" || !authorization.recurringCapable) {
    await database.batch([
      database
        .prepare(
          "UPDATE payment_authorization SET status='REVOKED', revoked_at=?, updated_at=? WHERE id=? AND status='PENDING'",
        )
        .bind(now, now, row.id),
      createPaymentRepository(database).consumeAuthorizationActionsStatement(row.id, now),
    ]);
    return failure(
      authorization.recurringCapable ? "AUTHORIZATION_REVOKED" : "RECURRING_NOT_CAPABLE",
      authorization.recurringCapable
        ? "The authorization was revoked before confirmation"
        : "The authorized instrument cannot hold a recurring mandate",
      command.requestId,
    );
  }
  if (!authorization.providerMethodRef)
    return failure(
      "RECURRING_NOT_CAPABLE",
      "The provider did not expose a stable authorization identity",
      command.requestId,
    );

  try {
    const applied = await database
      .batch([
        database
          .prepare(
            "UPDATE payment_authorization SET status='ACTIVE', recurring_capable=1, provider_method_ref=?, established_at=?, updated_at=? WHERE id=? AND status='PENDING'",
          )
          .bind(authorization.providerMethodRef, now, now, row.id),
        createPaymentRepository(database).consumeAuthorizationActionsStatement(row.id, now),
      ])
      .then((outcomes) => (outcomes[0]?.meta?.changes ?? 0) === 1);
    if (!applied)
      return failure("CONFLICT", "The authorization was concurrently resolved", command.requestId);
  } catch {
    // The live mandate identity is already owned by another authorization.
    await database.batch([
      database
        .prepare(
          "UPDATE payment_authorization SET status='REVOKED', revoked_at=?, updated_at=? WHERE id=? AND status='PENDING'",
        )
        .bind(now, now, row.id),
      createPaymentRepository(database).consumeAuthorizationActionsStatement(row.id, now),
    ]);
    return failure(
      "AUTHORIZATION_IDENTITY_IN_USE",
      "This instrument identity is already authorized",
      command.requestId,
    );
  }

  return {
    ok: true,
    value: { authorizationId: row.id, provider: row.provider },
    requestId: command.requestId,
  };
}
