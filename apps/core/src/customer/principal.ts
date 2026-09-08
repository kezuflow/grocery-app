import type { AppErrorCode, AuthenticatedRequest } from "@freshmarkets/contracts";
import { auditEventStatement } from "../audit/application/append-audit-event";

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

  type CustomerRow = {
    principalId: string | null;
    principalStatus: string | null;
    customerId: string | null;
    customerPrincipalId: string | null;
    customerStatus: string | null;
  };
  const readSql = `SELECT cp.id AS principalId,cp.status AS principalStatus,c.id AS customerId,c.principal_id AS customerPrincipalId,c.status AS customerStatus
    FROM user u LEFT JOIN customer_principal cp ON cp.auth_user_id=u.id LEFT JOIN customer c ON c.auth_user_id=u.id WHERE u.id=?`;
  const existing = await database.prepare(readSql).bind(user.id).first<CustomerRow>();
  if (existing?.principalId && existing.principalStatus !== "active")
    return failure("FORBIDDEN", "Customer access is disabled", input.requestId);
  if (existing?.customerId && existing.customerStatus !== "active")
    return failure("FORBIDDEN", "Customer access is disabled", input.requestId);
  if (
    existing?.customerId &&
    existing.principalId &&
    existing.customerPrincipalId === existing.principalId &&
    existing.customerStatus === "active"
  ) {
    return {
      ok: true,
      value: {
        user,
        principalId: existing.principalId,
        customerId: existing.customerId,
        customerStatus: existing.customerStatus,
      },
      requestId: input.requestId,
    };
  }

  try {
    const result = await database.batch<CustomerRow>([
      ...provisionCustomerStatements(database, user.id, input.requestId, now()),
      database.prepare(readSql).bind(user.id),
    ]);
    const customer = result.at(-1)?.results[0];
    if (!customer?.customerId || !customer.principalId || customer.customerStatus !== "active")
      return failure(
        "INTERNAL_ERROR",
        "Customer aggregate could not be reconciled",
        input.requestId,
      );
    return {
      ok: true,
      value: {
        user,
        principalId: customer.principalId,
        customerId: customer.customerId,
        customerStatus: customer.customerStatus,
      },
      requestId: input.requestId,
    };
  } catch {
    return failure(
      "CONFLICT",
      "Customer access changed or could not be provisioned; retry the request",
      input.requestId,
    );
  }
}

/** Compose onboarding with an owning command's other guards and effects. */
export function provisionCustomerStatements(
  database: D1Database,
  authUserId: string,
  requestId: string,
  occurredAt: number,
): D1PreparedStatement[] {
  const customerId = crypto.randomUUID();
  return [
    database
      .prepare(`INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at)
        SELECT ?,id,'active',?,? FROM user WHERE id=? AND NOT EXISTS(SELECT 1 FROM customer_principal WHERE auth_user_id=?)`)
      .bind(crypto.randomUUID(), occurredAt, occurredAt, authUserId, authUserId),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer_principal WHERE auth_user_id=? AND status='active')",
      )
      .bind(authUserId),
    database
      .prepare(`UPDATE customer SET principal_id=(SELECT id FROM customer_principal WHERE auth_user_id=?)
        WHERE auth_user_id=? AND principal_id IS NULL AND status='active'`)
      .bind(authUserId, authUserId),
    database
      .prepare(`INSERT INTO customer(id,auth_user_id,principal_id,status,created_at,updated_at)
        SELECT ?,auth_user_id,id,'active',?,? FROM customer_principal WHERE auth_user_id=? AND status='active'
        AND NOT EXISTS(SELECT 1 FROM customer WHERE auth_user_id=?)`)
      .bind(customerId, occurredAt, occurredAt, authUserId, authUserId),
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(
        SELECT 1 FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id
        WHERE c.auth_user_id=? AND c.status='active' AND cp.status='active')`)
      .bind(authUserId),
    auditEventStatement(
      database,
      {
        actorUserId: authUserId,
        action: "CUSTOMER.PROVISIONED",
        resourceType: "customer",
        resourceId: customerId,
        correlationId: requestId,
        idempotencyKey: `provision:${customerId}`,
        occurredAt,
      },
      {
        clause: "EXISTS(SELECT 1 FROM customer WHERE id=? AND auth_user_id=?)",
        binds: [customerId, authUserId],
      },
    ),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1 AND EXISTS(SELECT 1 FROM customer WHERE id=? AND auth_user_id=?)",
      )
      .bind(customerId, authUserId),
  ];
}

function failure(
  code: AppErrorCode,
  message: string,
  requestId: string,
): CustomerResolutionFailure {
  return { ok: false, error: { code, message, requestId } };
}
