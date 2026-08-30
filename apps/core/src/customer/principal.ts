import type { AppErrorCode, AuthenticatedRequest } from "@freshmarkets/contracts";

export type SessionUser = { id: string; email: string; name: string; emailVerified: boolean };

export type AuthenticatedCustomer = {
  user: SessionUser;
  principalId: string;
  customerId: string;
  customerStatus: string;
};

export type CustomerResolutionFailure = {
  ok: false;
  error: { code: AppErrorCode; message: string; requestId: string };
};

export type ResolvedCustomer =
  | { ok: true; value: AuthenticatedCustomer; requestId: string }
  | CustomerResolutionFailure;

export type PrincipalResolutionPorts = {
  /** Resolves the Better Auth session user for the request headers. */
  getSessionUser: (headers: AuthenticatedRequest["headers"]) => Promise<SessionUser | null>;
  now: () => number;
};

/**
 * Resolve the authenticated session into the application-owned Customer
 * aggregate through its Application IAM principal, provisioning either level
 * on first sight and relinking legacy customer rows. IAM owns
 * `customer_principal`; Customers owns `customer`.
 */
export async function resolveAuthenticatedCustomer(
  database: D1Database,
  input: AuthenticatedRequest,
  ports: PrincipalResolutionPorts,
): Promise<ResolvedCustomer> {
  const { getSessionUser, now } = ports;
  const user = await getSessionUser(input.headers);
  if (!user) return failure("UNAUTHENTICATED", "Authentication is required", input.requestId);

  let principal = await database
    .prepare("SELECT id, status FROM customer_principal WHERE auth_user_id=?")
    .bind(user.id)
    .first<{ id: string; status: string }>();
  if (!principal) {
    const principalId = crypto.randomUUID();
    await database
      .prepare(
        "INSERT OR IGNORE INTO customer_principal (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      )
      .bind(principalId, user.id, now(), now())
      .run();
    principal = await database
      .prepare("SELECT id, status FROM customer_principal WHERE auth_user_id=?")
      .bind(user.id)
      .first<{ id: string; status: string }>();
  }
  if (!principal)
    return failure("INTERNAL_ERROR", "Customer principal could not be resolved", input.requestId);
  if (principal.status !== "active")
    return failure("FORBIDDEN", "Customer access is disabled", input.requestId);

  let customer = await database
    .prepare("SELECT id, status FROM customer WHERE principal_id=?")
    .bind(principal.id)
    .first<{ id: string; status: string }>();
  if (!customer) {
    const legacy = await database
      .prepare("SELECT id, status FROM customer WHERE auth_user_id=? AND principal_id IS NULL")
      .bind(user.id)
      .first<{ id: string; status: string }>();
    if (legacy) {
      await database
        .prepare("UPDATE customer SET principal_id=? WHERE id=? AND principal_id IS NULL")
        .bind(principal.id, legacy.id)
        .run();
    } else {
      const customerId = crypto.randomUUID();
      await database
        .prepare(
          "INSERT OR IGNORE INTO customer (id, auth_user_id, principal_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
        )
        .bind(customerId, user.id, principal.id, now(), now())
        .run();
    }
    customer = await database
      .prepare("SELECT id, status FROM customer WHERE principal_id=?")
      .bind(principal.id)
      .first<{ id: string; status: string }>();
  }
  if (!customer)
    return failure("INTERNAL_ERROR", "Customer aggregate could not be reconciled", input.requestId);
  if (customer.status !== "active")
    return failure("FORBIDDEN", "Customer access is disabled", input.requestId);
  return {
    ok: true,
    value: {
      user,
      principalId: principal.id,
      customerId: customer.id,
      customerStatus: customer.status,
    },
    requestId: input.requestId,
  };
}

function failure(
  code: AppErrorCode,
  message: string,
  requestId: string,
): CustomerResolutionFailure {
  return { ok: false, error: { code, message, requestId } };
}
