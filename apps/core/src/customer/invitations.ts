import type {
  AcceptCustomerInvitationRequest,
  AuthenticatedRequest,
  CustomerInvitationOffer,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../idempotency";
import { provisionCustomerStatements, type SessionUser } from "./principal";

type InvitationPorts = {
  database: D1Database;
  session: (request: AuthenticatedRequest) => Promise<SessionUser | null>;
  now: () => number;
};
const receiptSchema = z.object({ customerId: z.string().min(1), invitationId: z.string().min(1) });
const scope = "customer.invitation.accept";
const resultType = "customer_invitation_acceptance_snapshot";
const required = (database: D1Database) =>
  database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");

export async function getMyCustomerInvitation(
  ports: InvitationPorts,
  request: AuthenticatedRequest,
): Promise<RpcResult<CustomerInvitationOffer | null>> {
  const user = await ports.session(request);
  if (!user)
    return failure("UNAUTHENTICATED", "Sign in to review your invitation", request.requestId);
  if (!user.emailVerified)
    return failure(
      "FORBIDDEN",
      "Verify your email before reviewing an invitation",
      request.requestId,
    );
  const row = await ports.database
    .prepare(`SELECT i.id,i.version,i.expires_at FROM customer_invitation i JOIN user u ON lower(trim(u.email))=i.email_normalized
    WHERE u.id=? AND u.email_verified=1 AND i.status='PENDING' AND i.expires_at>?`)
    .bind(user.id, ports.now())
    .first<{ id: string; version: number; expires_at: number }>();
  return {
    ok: true,
    value: row
      ? {
          invitationId: row.id,
          expectedVersion: row.version,
          expiresAt: new Date(row.expires_at).toISOString(),
        }
      : null,
    requestId: request.requestId,
  };
}

/** Verified identity, provisioning and acceptance share one transaction. */
export async function acceptCustomerInvitation(
  ports: InvitationPorts,
  request: AcceptCustomerInvitationRequest,
): Promise<RpcResult<z.infer<typeof receiptSchema>>> {
  const user = await ports.session(request);
  if (!user)
    return failure("UNAUTHENTICATED", "Sign in to accept your invitation", request.requestId);
  if (!user.emailVerified)
    return failure(
      "FORBIDDEN",
      "Verify your email before accepting an invitation",
      request.requestId,
    );
  const database = ports.database;
  const identity = await database
    .prepare(
      `SELECT i.id FROM customer_invitation i JOIN user u ON lower(trim(u.email))=i.email_normalized WHERE i.id=? AND u.id=? AND u.email_verified=1`,
    )
    .bind(request.invitationId, user.id)
    .first();
  if (!identity)
    return failure(
      "NOT_FOUND",
      "No invitation is available for this verified account",
      request.requestId,
    );
  const key = `${user.id}:${request.idempotencyKey}`;
  const hash = await requestHash({
    invitationId: request.invitationId,
    expectedVersion: request.expectedVersion,
  });
  const replay = async (): Promise<RpcResult<z.infer<typeof receiptSchema>> | null> => {
    const existing = await findIdempotencyRecord(database, scope, key);
    if (!existing) return null;
    if (existing.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key was used for a different invitation decision",
        request.requestId,
      );
    if (existing.status !== "SUCCEEDED") return null;
    const parsed = receiptSchema.safeParse(parseJson(existing.resultReference));
    if (
      existing.resultType !== resultType ||
      !parsed.success ||
      parsed.data.invitationId !== request.invitationId
    )
      return failure(
        "INTERNAL_ERROR",
        "The saved invitation result could not be read",
        request.requestId,
      );
    return { ok: true, value: parsed.data, requestId: request.requestId };
  };
  const previous = await replay();
  if (previous) return previous;
  const now = ports.now();
  try {
    const results = await database.batch<{ result_reference: string }>([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer_invitation i JOIN user u ON lower(trim(u.email))=i.email_normalized
        WHERE i.id=? AND i.status='PENDING' AND i.version=? AND i.expires_at>? AND u.id=? AND u.email_verified=1)`)
        .bind(request.invitationId, request.expectedVersion, now, user.id),
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES(?,?,?,'PROCESSING',?,?,?)
        ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',result_type=excluded.result_type,updated_at=excluded.updated_at WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('PROCESSING','FAILED')`)
        .bind(scope, key, hash, resultType, now, now),
      required(database),
      ...provisionCustomerStatements(database, user.id, request.requestId, now),
      database
        .prepare(
          "UPDATE customer_invitation SET status='ACCEPTED',accepted_customer_id=(SELECT id FROM customer WHERE auth_user_id=?),version=version+1,updated_at=? WHERE id=? AND status='PENDING' AND version=? AND expires_at>?",
        )
        .bind(user.id, now, request.invitationId, request.expectedVersion, now),
      required(database),
      auditEventStatement(database, {
        actorUserId: user.id,
        action: "CUSTOMER.INVITATION_ACCEPTED",
        resourceType: "customer_invitation",
        resourceId: request.invitationId,
        correlationId: request.requestId,
        idempotencyKey: `${scope}:${request.invitationId}`,
        occurredAt: now,
      }),
      required(database),
      database
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(SELECT json_object('customerId',accepted_customer_id,'invitationId',id) FROM customer_invitation WHERE id=?),updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`,
        )
        .bind(request.invitationId, now, scope, key, hash),
      required(database),
      database
        .prepare(
          "SELECT result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
        )
        .bind(scope, key),
    ]);
    const parsed = receiptSchema.safeParse(
      parseJson(results.at(-1)?.results[0]?.result_reference ?? null),
    );
    if (!parsed.success)
      return failure(
        "INTERNAL_ERROR",
        "The saved invitation result could not be read",
        request.requestId,
      );
    return { ok: true, value: parsed.data, requestId: request.requestId };
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "The invitation or account changed; refresh and retry", request.requestId)
    );
  }
}

function parseJson(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}
function failure(
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "IDEMPOTENCY_CONFLICT"
    | "INTERNAL_ERROR"
    | "CONFLICT",
  message: string,
  requestId: string,
): { ok: false; error: { code: typeof code; message: string; requestId: string } } {
  return { ok: false, error: { code, message, requestId } };
}
