import type {
  AdminCustomerInvitationListRequest,
  AdminClosureRequestCommand,
  AdminPrivacyActionRequest,
  AdminPrivacyListRequest,
  CustomerInvitationPage,
  CustomerInvitationView,
  PrivacyRequestAction,
  PrivacyRequestPage,
  PrivacyRequestStatus,
  PrivacyRequestView,
  RpcResult,
} from "@freshmarkets/contracts";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { z } from "@freshmarkets/validation";
import {
  privacyRequestActions,
  privacyRequestStatuses,
  customerClosureRequestTypes,
} from "@freshmarkets/contracts";
import {
  beginCustomerAdministrationWrite,
  completeCustomerAdministrationWrite,
  requireCustomerWrite,
} from "./customer-administration-write";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { boundListLimit } from "./customer-administration-access";
import {
  decodeStaffCursor,
  encodeStaffCursor,
  resolveCustomerAdministrationAccess,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";

const CLOSURE_SCOPE = "admin.customers.closure";
const PRIVACY_ACTION_SCOPE = "admin.privacy.action";
const privacyReceiptSchema = z.object({
  privacyRequestId: z.string(),
  customerId: z.string(),
  requestType: z.enum(customerClosureRequestTypes),
  status: z.enum(privacyRequestStatuses),
  requestedAt: z.string(),
  verifiedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  assignedStaffId: z.string().nullable(),
  reason: z.string().nullable(),
  resolution: z.string().nullable(),
  version: z.number().int().positive(),
  availableActions: z.array(z.enum(privacyRequestActions)),
});

async function readCustomerIdentity(
  database: D1Database,
  customerId: string,
): Promise<{
  id: string;
  principal_id: string;
  auth_user_id: string;
  version: number;
  principalStatus: string;
} | null> {
  const customer = await database
    .prepare(
      "SELECT c.id, c.principal_id, c.auth_user_id, c.version, cp.status AS principalStatus FROM customer c JOIN customer_principal cp ON cp.id = c.principal_id WHERE c.id = ?",
    )
    .bind(customerId)
    .first<{
      id: string;
      principal_id: string;
      auth_user_id: string;
      version: number;
      principalStatus: string;
    }>();
  return customer ?? null;
}

type InvitationRow = {
  id: string;
  version: number;
  email_normalized: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  invited_by_staff_id: string | null;
  expires_at: number;
  created_at: number;
};

function toInvitationView(row: InvitationRow): CustomerInvitationView {
  return {
    invitationId: row.id,
    version: row.version,
    email: row.email_normalized,
    status: row.status,
    invitedByStaffId: row.invited_by_staff_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Bounded invitation queue for global customer readers. */
export async function listCustomerInvitations(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerInvitationListRequest,
): Promise<RpcResult<CustomerInvitationPage>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
  if (!access.ok) return access;
  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }
  const clause = cursor ? "WHERE (created_at < ? OR (created_at = ? AND id < ?))" : "";
  const binds = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const rows = await deps.db
    .prepare(
      `SELECT id, version, email_normalized, status, invited_by_staff_id, expires_at, created_at
       FROM customer_invitation ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<InvitationRow>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map(toInvitationView);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

export { inviteCustomer } from "./customer-invitations";

export { changeCustomerAccess } from "./change-customer-access";
export { revokeCustomerSessions } from "./revoke-customer-sessions";

/** Record a reviewed customer privacy request without changing retained history. */
export async function requestCustomerClosure(
  deps: CustomerAdministrationDeps,
  request: AdminClosureRequestCommand,
): Promise<RpcResult<PrivacyRequestView>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (!reason)
    return privacyFailure("VALIDATION_FAILED", "A reason is required", request.requestId);
  const hash = await requestHash({
    customerId: request.customerId,
    requestType: request.requestType,
    reason,
  });
  const resultType = "customer_privacy_request_snapshot";
  const previous = await replayPrivacyCommand(deps.db, CLOSURE_SCOPE, request, hash, resultType);
  if (previous) return previous;
  const customer = await readCustomerIdentity(deps.db, request.customerId);
  if (!customer) return privacyFailure("NOT_FOUND", "Customer not found", request.requestId);
  const now = Date.now();
  const id = crypto.randomUUID();
  const value = toPrivacyView({
    id,
    customer_id: request.customerId,
    request_type: request.requestType,
    status: "SUBMITTED",
    requested_at: now,
    verified_at: null,
    resolved_at: null,
    assigned_staff_id: access.value.staffId,
    reason,
    resolution: null,
    version: 1,
  });
  try {
    await deps.db.batch([
      ...beginCustomerAdministrationWrite(deps.db, {
        ...access.value,
        scope: CLOSURE_SCOPE,
        key: request.idempotencyKey,
        hash,
        resultType,
        now,
      }),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer WHERE id=? AND auth_user_id=? AND principal_id=? AND version=?)",
        )
        .bind(request.customerId, customer.auth_user_id, customer.principal_id, customer.version),
      deps.db
        .prepare(
          "INSERT INTO privacy_request(id,customer_id,request_type,status,requested_at,assigned_staff_id,reason,version,idempotency_key,created_at,updated_at) VALUES(?,?,?,'SUBMITTED',?,?,?,1,?,?,?)",
        )
        .bind(
          id,
          request.customerId,
          request.requestType,
          now,
          access.value.staffId,
          reason,
          request.idempotencyKey,
          now,
          now,
        ),
      requireCustomerWrite(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CUSTOMER.CLOSURE_REQUESTED",
        resourceType: "privacy_request",
        resourceId: id,
        reason,
        details: { requestType: request.requestType },
        correlationId: request.requestId,
        idempotencyKey: `${CLOSURE_SCOPE}:${request.idempotencyKey}`,
        occurredAt: now,
      }),
      requireCustomerWrite(deps.db),
      ...completeCustomerAdministrationWrite(deps.db, {
        scope: CLOSURE_SCOPE,
        key: request.idempotencyKey,
        hash,
        result: value,
        now,
      }),
    ]);
  } catch {
    return (
      (await replayPrivacyCommand(deps.db, CLOSURE_SCOPE, request, hash, resultType)) ??
      privacyFailure(
        "CONFLICT",
        "Customer or staff access changed; refresh and retry",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}

type PrivacyRow = {
  id: string;
  customer_id: string;
  request_type: "ACCESS" | "CORRECTION" | "CLOSURE" | "ANONYMIZATION";
  status: PrivacyRequestStatus;
  requested_at: number;
  verified_at: number | null;
  resolved_at: number | null;
  assigned_staff_id: string | null;
  reason: string | null;
  resolution: string | null;
  version: number;
};

function toPrivacyView(row: PrivacyRow): PrivacyRequestView {
  return {
    availableActions: privacyRequestActions.filter(
      (action) =>
        PRIVACY_TRANSITIONS[action].from.includes(row.status) &&
        !(row.request_type === "ANONYMIZATION" && action === "COMPLETE"),
    ),
    privacyRequestId: row.id,
    customerId: row.customer_id,
    requestType: row.request_type,
    status: row.status,
    requestedAt: new Date(row.requested_at).toISOString(),
    verifiedAt: row.verified_at === null ? null : new Date(row.verified_at).toISOString(),
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    assignedStaffId: row.assigned_staff_id,
    reason: row.reason,
    resolution: row.resolution,
    version: row.version,
  };
}

async function readPrivacyRequest(
  database: D1Database,
  privacyRequestId: string,
): Promise<PrivacyRequestView | null> {
  const row = await database
    .prepare(
      "SELECT id, customer_id, request_type, status, requested_at, verified_at, resolved_at, assigned_staff_id, reason, resolution, version FROM privacy_request WHERE id = ?",
    )
    .bind(privacyRequestId)
    .first<PrivacyRow>();
  return row ? toPrivacyView(row) : null;
}

/** Bounded privacy queue for global customer readers. */
export async function listPrivacyRequests(
  deps: CustomerAdministrationDeps,
  request: AdminPrivacyListRequest,
): Promise<RpcResult<PrivacyRequestPage>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
  if (!access.ok) return access;
  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (request.customerId) {
    clauses.push("customer_id=?");
    binds.push(request.customerId);
  }
  if (request.status !== undefined) {
    clauses.push("status = ?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(requested_at < ? OR (requested_at = ? AND id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `SELECT id, customer_id, request_type, status, requested_at, verified_at, resolved_at,
              assigned_staff_id, reason, resolution, version
       FROM privacy_request ${where} ORDER BY requested_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<PrivacyRow>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map(toPrivacyView);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.requested_at, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

const PRIVACY_TRANSITIONS: Record<
  PrivacyRequestAction,
  { from: PrivacyRequestStatus[]; to: PrivacyRequestStatus; terminal: boolean }
> = {
  VERIFY: { from: ["SUBMITTED"], to: "VERIFYING", terminal: false },
  APPROVE: { from: ["SUBMITTED", "VERIFYING"], to: "APPROVED", terminal: false },
  REJECT: { from: ["SUBMITTED", "VERIFYING"], to: "REJECTED", terminal: true },
  BEGIN_PROCESSING: { from: ["APPROVED", "ESCALATED"], to: "PROCESSING", terminal: false },
  COMPLETE: { from: ["PROCESSING"], to: "COMPLETED", terminal: true },
  ESCALATE: { from: ["VERIFYING", "PROCESSING"], to: "ESCALATED", terminal: false },
};

/** Apply the reviewed workflow and all dependent closure effects atomically. */
export async function applyPrivacyAction(
  deps: CustomerAdministrationDeps,
  request: AdminPrivacyActionRequest,
): Promise<RpcResult<PrivacyRequestView>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (!reason)
    return privacyFailure("VALIDATION_FAILED", "A reason is required", request.requestId);
  const hash = await requestHash({
    privacyRequestId: request.privacyRequestId,
    action: request.action,
    reason,
    expectedVersion: request.expectedVersion,
  });
  const resultType = "customer_privacy_action_snapshot";
  const previous = await replayPrivacyCommand(
    deps.db,
    PRIVACY_ACTION_SCOPE,
    request,
    hash,
    resultType,
    request.privacyRequestId,
  );
  if (previous) return previous;
  const row = await deps.db
    .prepare(
      "SELECT id,customer_id,request_type,status,requested_at,verified_at,resolved_at,assigned_staff_id,reason,resolution,version FROM privacy_request WHERE id=?",
    )
    .bind(request.privacyRequestId)
    .first<PrivacyRow>();
  if (!row) return privacyFailure("NOT_FOUND", "Privacy request not found", request.requestId);
  if (row.version !== request.expectedVersion)
    return privacyFailure(
      "STALE_VERSION",
      "Request changed; refresh before retrying",
      request.requestId,
    );
  const transition = PRIVACY_TRANSITIONS[request.action];
  if (!transition.from.includes(row.status))
    return privacyFailure(
      "ILLEGAL_TRANSITION",
      `${request.action} is not legal from ${row.status}`,
      request.requestId,
    );
  if (request.action === "COMPLETE" && row.request_type === "ANONYMIZATION")
    return privacyFailure(
      "CONFLICT",
      "Anonymization is unavailable until approved retention and field policy is configured",
      request.requestId,
    );
  const customer = await readCustomerIdentity(deps.db, row.customer_id);
  if (!customer) return privacyFailure("NOT_FOUND", "Customer not found", request.requestId);
  const closeAccess = request.action === "COMPLETE" && row.request_type === "CLOSURE";
  const sessionCount = closeAccess
    ? await deps.db
        .prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
        .bind(customer.auth_user_id)
        .first<{ count: number }>()
    : null;
  if (closeAccess && !sessionCount)
    return privacyFailure(
      "INTERNAL_ERROR",
      "Customer sessions could not be reviewed",
      request.requestId,
    );
  const now = Date.now();
  const updated: PrivacyRow = {
    ...row,
    status: transition.to,
    verified_at: request.action === "VERIFY" ? now : row.verified_at,
    resolved_at: transition.terminal ? now : row.resolved_at,
    assigned_staff_id: access.value.staffId,
    resolution: transition.terminal ? reason : row.resolution,
    version: row.version + 1,
  };
  const value = toPrivacyView(updated);
  const closureStatements: D1PreparedStatement[] =
    closeAccess && sessionCount
      ? [
          deps.db
            .prepare(
              "UPDATE customer SET version=version+1,updated_at=? WHERE id=? AND auth_user_id=? AND principal_id=? AND version=?",
            )
            .bind(
              now,
              row.customer_id,
              customer.auth_user_id,
              customer.principal_id,
              customer.version,
            ),
          requireCustomerWrite(deps.db),
          deps.db
            .prepare(
              "UPDATE customer_principal SET status='disabled',updated_at=? WHERE id=? AND auth_user_id=? AND status=?",
            )
            .bind(now, customer.principal_id, customer.auth_user_id, customer.principalStatus),
          requireCustomerWrite(deps.db),
          deps.db
            .prepare(
              "INSERT INTO commitment_abort(id) SELECT -36 WHERE (SELECT count(*) FROM session WHERE user_id=?)!=?",
            )
            .bind(customer.auth_user_id, sessionCount.count),
          deps.db.prepare("DELETE FROM session WHERE user_id=?").bind(customer.auth_user_id),
          deps.db
            .prepare(
              "INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=? OR EXISTS(SELECT 1 FROM session WHERE user_id=?)",
            )
            .bind(sessionCount.count, customer.auth_user_id),
          auditEventStatement(deps.db, {
            actorUserId: access.value.authUserId,
            action: "CUSTOMER.CLOSED",
            resourceType: "customer",
            resourceId: row.customer_id,
            reason,
            before: { accessStatus: customer.principalStatus },
            after: { accessStatus: "disabled" },
            details: { privacyRequestId: row.id, revokedSessionCount: sessionCount.count },
            correlationId: request.requestId,
            idempotencyKey: `${PRIVACY_ACTION_SCOPE}:${request.idempotencyKey}:closure`,
            occurredAt: now,
          }),
          requireCustomerWrite(deps.db),
        ]
      : [];
  try {
    await deps.db.batch([
      ...beginCustomerAdministrationWrite(deps.db, {
        ...access.value,
        scope: PRIVACY_ACTION_SCOPE,
        key: request.idempotencyKey,
        hash,
        resultType,
        now,
      }),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer WHERE id=? AND auth_user_id=? AND principal_id=? AND version=?)",
        )
        .bind(row.customer_id, customer.auth_user_id, customer.principal_id, customer.version),
      deps.db
        .prepare(
          "UPDATE privacy_request SET status=?,verified_at=?,resolved_at=?,assigned_staff_id=?,resolution=?,updated_at=?,version=version+1 WHERE id=? AND status=? AND version=? AND customer_id=? AND request_type=?",
        )
        .bind(
          updated.status,
          updated.verified_at,
          updated.resolved_at,
          updated.assigned_staff_id,
          updated.resolution,
          now,
          row.id,
          row.status,
          request.expectedVersion,
          row.customer_id,
          row.request_type,
        ),
      requireCustomerWrite(deps.db),
      ...closureStatements,
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "PRIVACY.ACTION_APPLIED",
        resourceType: "privacy_request",
        resourceId: row.id,
        reason,
        before: { status: row.status },
        after: { status: transition.to },
        details: { action: request.action },
        correlationId: request.requestId,
        idempotencyKey: `${PRIVACY_ACTION_SCOPE}:${request.idempotencyKey}:action`,
        occurredAt: now,
      }),
      requireCustomerWrite(deps.db),
      ...completeCustomerAdministrationWrite(deps.db, {
        scope: PRIVACY_ACTION_SCOPE,
        key: request.idempotencyKey,
        hash,
        result: value,
        now,
      }),
    ]);
  } catch {
    return (
      (await replayPrivacyCommand(
        deps.db,
        PRIVACY_ACTION_SCOPE,
        request,
        hash,
        resultType,
        row.id,
      )) ??
      privacyFailure(
        "CONFLICT",
        "Request, customer or staff access changed; refresh and retry",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}

async function replayPrivacyCommand(
  database: D1Database,
  scope: string,
  request: { requestId: string; idempotencyKey: string },
  hash: string,
  resultType: string,
  resourceId?: string,
): Promise<RpcResult<PrivacyRequestView> | null> {
  const saved = await findIdempotencyRecord(database, scope, request.idempotencyKey);
  if (!saved) return null;
  if (saved.requestHash !== hash)
    return privacyFailure(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used with a different request",
      request.requestId,
    );
  if (saved.status !== "SUCCEEDED") return null;
  if (
    saved.resultType === scope &&
    saved.resultReference &&
    (!resourceId || saved.resultReference === resourceId)
  ) {
    const legacy = await readPrivacyRequest(database, saved.resultReference);
    if (legacy) return { ok: true, value: legacy, requestId: request.requestId };
  }
  if (saved.resultType === resultType && saved.resultReference) {
    try {
      const parsed = privacyReceiptSchema.safeParse(JSON.parse(saved.resultReference));
      if (parsed.success && (!resourceId || parsed.data.privacyRequestId === resourceId))
        return { ok: true, value: parsed.data, requestId: request.requestId };
    } catch {
      /* Invalid saved evidence cannot authorize another write. */
    }
  }
  return privacyFailure(
    "INTERNAL_ERROR",
    "The saved privacy result could not be read",
    request.requestId,
  );
}
function privacyFailure(
  code: import("@freshmarkets/contracts").AppErrorCode,
  message: string,
  requestId: string,
) {
  return { ok: false as const, error: { code, message, requestId } };
}
