import type {
  AdminCustomerInviteRequest,
  CustomerInvitationView,
  RevokeCustomerInvitationRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  resolveCustomerAdministrationAccess,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";

const viewSchema = z.object({
  invitationId: z.string(),
  version: z.number().int().positive(),
  email: z.string(),
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]),
  invitedByStaffId: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
const required = (db: D1Database) =>
  db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");
const viewSql = `SELECT json_object('invitationId',id,'version',version,'email',email_normalized,'status',status,'invitedByStaffId',invited_by_staff_id,'expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ',expires_at/1000.0,'unixepoch'),'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch')) AS value FROM customer_invitation WHERE id=?`;

export function inviteCustomer(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerInviteRequest,
): Promise<RpcResult<CustomerInvitationView>> {
  return changeInvitation(deps, request, {
    kind: "create",
    email: request.email.trim().toLowerCase(),
  });
}
export function revokeCustomerInvitation(
  deps: CustomerAdministrationDeps,
  request: RevokeCustomerInvitationRequest,
): Promise<RpcResult<CustomerInvitationView>> {
  return changeInvitation(deps, request, {
    kind: "revoke",
    invitationId: request.invitationId,
    expectedVersion: request.expectedVersion,
    reason: request.reason.trim(),
  });
}
async function changeInvitation(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerInviteRequest | RevokeCustomerInvitationRequest,
  change:
    | { kind: "create"; email: string }
    | { kind: "revoke"; invitationId: string; expectedVersion: number; reason: string },
): Promise<RpcResult<CustomerInvitationView>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  if (change.kind === "create" && !z.string().email().max(320).safeParse(change.email).success)
    return failure("VALIDATION_FAILED", "A valid email is required", request.requestId);
  if (change.kind === "revoke" && !change.reason)
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  const scope =
    change.kind === "create" ? "admin.customers.invite" : "admin.customers.invitation.revoke";
  const resultType = `${scope}.snapshot`;
  const payload =
    change.kind === "create"
      ? { email: change.email }
      : {
          invitationId: change.invitationId,
          expectedVersion: change.expectedVersion,
          reason: change.reason,
        };
  const hash = await requestHash(payload);
  const db = deps.db;
  const replay = async (): Promise<RpcResult<CustomerInvitationView> | null> => {
    const record = await findIdempotencyRecord(db, scope, request.idempotencyKey);
    if (!record) return null;
    if (record.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This key was used for a different request",
        request.requestId,
      );
    if (record.status !== "SUCCEEDED") return null;
    let raw = record.resultReference;
    if (record.resultType === scope && change.kind === "create" && raw) {
      raw = (await db.prepare(viewSql).bind(raw).first<{ value: string }>())?.value ?? null;
    } else if (record.resultType !== resultType)
      return failure(
        "INTERNAL_ERROR",
        "The saved invitation result could not be read",
        request.requestId,
      );
    const result = viewSchema.safeParse(parseJson(raw));
    return result.success
      ? { ok: true, value: result.data, requestId: request.requestId }
      : failure(
          "INTERNAL_ERROR",
          "The saved invitation result could not be read",
          request.requestId,
        );
  };
  const previous = await replay();
  if (previous) return previous;
  const now = Date.now();
  const id = change.kind === "create" ? crypto.randomUUID() : change.invitationId;
  try {
    const results = await db.batch<{ value: string }>([
      db
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global' JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='customers.manage')`,
        )
        .bind(access.value.staffId, access.value.authUserId),
      db
        .prepare(
          `INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES(?,?,?,'PROCESSING',?,?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',result_type=excluded.result_type,updated_at=excluded.updated_at WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('PROCESSING','FAILED')`,
        )
        .bind(scope, request.idempotencyKey, hash, resultType, now, now),
      required(db),
      change.kind === "create"
        ? db
            .prepare(
              "INSERT INTO customer_invitation(id,email_normalized,status,invited_by_staff_id,expires_at,version,idempotency_key,created_at,updated_at) VALUES(?,?,'PENDING',?,?,1,?,?,?)",
            )
            .bind(
              id,
              change.email,
              access.value.staffId,
              now + 14 * 24 * 60 * 60 * 1000,
              request.idempotencyKey,
              now,
              now,
            )
        : db
            .prepare(
              "UPDATE customer_invitation SET status='REVOKED',version=version+1,updated_at=? WHERE id=? AND status='PENDING' AND version=?",
            )
            .bind(now, id, change.expectedVersion),
      required(db),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: change.kind === "create" ? "CUSTOMER.INVITED" : "CUSTOMER.INVITATION_REVOKED",
        resourceType: "customer_invitation",
        resourceId: id,
        reason: change.kind === "revoke" ? change.reason : null,
        correlationId: request.requestId,
        idempotencyKey: `${scope}:${request.idempotencyKey}`,
        occurredAt: now,
      }),
      required(db),
      db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(${viewSql}),updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`,
        )
        .bind(id, now, scope, request.idempotencyKey, hash),
      required(db),
      db
        .prepare(
          "SELECT result_reference AS value FROM idempotency_records WHERE scope=? AND idempotency_key=?",
        )
        .bind(scope, request.idempotencyKey),
    ]);
    const result = viewSchema.safeParse(parseJson(results.at(-1)?.results[0]?.value ?? null));
    return result.success
      ? { ok: true, value: result.data, requestId: request.requestId }
      : failure(
          "INTERNAL_ERROR",
          "The saved invitation result could not be read",
          request.requestId,
        );
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "The invitation or your access changed; refresh and retry",
        request.requestId,
      )
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
  code: "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT" | "INTERNAL_ERROR" | "CONFLICT",
  message: string,
  requestId: string,
): { ok: false; error: { code: typeof code; message: string; requestId: string } } {
  return { ok: false, error: { code, message, requestId } };
}
