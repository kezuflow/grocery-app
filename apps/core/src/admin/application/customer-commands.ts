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
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import { boundListLimit } from "./customer-administration-access";
import {
  decodeStaffCursor,
  encodeStaffCursor,
  resolveCustomerAdministrationAccess,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";

const CLOSURE_SCOPE = "admin.customers.closure";
const PRIVACY_ACTION_SCOPE = "admin.privacy.action";

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

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

function idempotencyFailed(database: D1Database, scope: string, key: string): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
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

/** Open a privacy/closure request; auditable and replayable. */
export async function requestCustomerClosure(
  deps: CustomerAdministrationDeps,
  request: AdminClosureRequestCommand,
): Promise<RpcResult<PrivacyRequestView>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "A reason is required",
        requestId: request.requestId,
      },
    };
  }
  const customer = await readCustomerIdentity(deps.db, request.customerId);
  if (!customer) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Customer not found", requestId: request.requestId },
    };
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    CLOSURE_SCOPE,
    request.idempotencyKey,
    {
      customerId: request.customerId,
      requestType: request.requestType,
      reason,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency key was used with a different request",
          requestId: request.requestId,
        },
      };
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const existing = await readPrivacyRequest(deps.db, claim.existing.resultReference);
      if (existing) return { ok: true, value: existing, requestId: request.requestId };
    }
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "The closure command is still processing",
        requestId: request.requestId,
      },
    };
  }

  const privacyRequestId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "INSERT INTO privacy_request (id, customer_id, request_type, status, requested_at, assigned_staff_id, reason, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, 1, ?, ?, ?)",
        )
        .bind(
          privacyRequestId,
          request.customerId,
          request.requestType,
          now,
          access.value.staffId,
          reason,
          request.idempotencyKey,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CUSTOMER.CLOSURE_REQUESTED",
        resourceType: "privacy_request",
        resourceId: privacyRequestId,
        reason,
        details: { requestType: request.requestType },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, CLOSURE_SCOPE, request.idempotencyKey, privacyRequestId, now),
    ]);
  } catch (error) {
    log("error", "admin.customers.closure_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, CLOSURE_SCOPE, request.idempotencyKey);
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "The closure request could not be created",
        requestId: request.requestId,
      },
    };
  }

  const created = await readPrivacyRequest(deps.db, privacyRequestId);
  if (!created) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The privacy request could not be read back",
        requestId: request.requestId,
      },
    };
  }
  return { ok: true, value: created, requestId: request.requestId };
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

/** Apply a closed privacy action through the legal transition map. */
export async function applyPrivacyAction(
  deps: CustomerAdministrationDeps,
  request: AdminPrivacyActionRequest,
): Promise<RpcResult<PrivacyRequestView>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "A reason is required",
        requestId: request.requestId,
      },
    };
  }

  const row = await deps.db
    .prepare(
      "SELECT id, customer_id, request_type, status, requested_at, verified_at, resolved_at, assigned_staff_id, reason, resolution, version FROM privacy_request WHERE id = ?",
    )
    .bind(request.privacyRequestId)
    .first<PrivacyRow & { version: number }>();
  if (!row) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Privacy request not found",
        requestId: request.requestId,
      },
    };
  }

  const transition = PRIVACY_TRANSITIONS[request.action];
  if (!transition.from.includes(row.status)) {
    return {
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        message: `${request.action} is not legal from ${row.status}`,
        requestId: request.requestId,
      },
    };
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    PRIVACY_ACTION_SCOPE,
    request.idempotencyKey,
    {
      privacyRequestId: request.privacyRequestId,
      action: request.action,
      reason,
      expectedVersion: request.expectedVersion,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency key was used with a different request",
          requestId: request.requestId,
        },
      };
    }
    if (claim.existing?.status === "SUCCEEDED") {
      const existing = await readPrivacyRequest(deps.db, request.privacyRequestId);
      if (existing) return { ok: true, value: existing, requestId: request.requestId };
    }
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "The privacy action is still processing",
        requestId: request.requestId,
      },
    };
  }

  const verifiedAt = request.action === "VERIFY" ? now : row.verified_at;
  const resolvedAt = transition.terminal ? now : row.resolved_at;
  const resolution = transition.terminal ? reason : row.resolution;
  const appliedGuard =
    "EXISTS (SELECT 1 FROM privacy_request WHERE id=? AND status=? AND version=?)";
  const appliedGuardBinds = [request.privacyRequestId, transition.to, request.expectedVersion + 1];
  let batchResults: D1Result[];
  try {
    batchResults = await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE privacy_request SET status=?, verified_at=?, resolved_at=?, assigned_staff_id=?, resolution=?, updated_at=?, version=version+1 WHERE id=? AND status=? AND version=?",
        )
        .bind(
          transition.to,
          verifiedAt,
          resolvedAt,
          access.value.staffId,
          resolution,
          now,
          request.privacyRequestId,
          row.status,
          request.expectedVersion,
        ),
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: "PRIVACY.ACTION_APPLIED",
          resourceType: "privacy_request",
          resourceId: request.privacyRequestId,
          reason,
          before: { status: row.status },
          after: { status: transition.to },
          details: { action: request.action },
          correlationId: request.requestId,
          occurredAt: now,
        },
        { clause: appliedGuard, binds: appliedGuardBinds },
      ),
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${appliedGuard}`,
        )
        .bind(
          request.privacyRequestId,
          now,
          PRIVACY_ACTION_SCOPE,
          request.idempotencyKey,
          ...appliedGuardBinds,
        ),
    ]);
  } catch (error) {
    log("error", "admin.privacy.action_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, PRIVACY_ACTION_SCOPE, request.idempotencyKey);
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "The privacy action could not be applied",
        requestId: request.requestId,
      },
    };
  }

  if ((batchResults[0]?.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, PRIVACY_ACTION_SCOPE, request.idempotencyKey);
    return {
      ok: false,
      error: {
        code: "STALE_VERSION",
        message: "Request changed; refresh before retrying",
        requestId: request.requestId,
      },
    };
  }
  const updated = await readPrivacyRequest(deps.db, request.privacyRequestId);
  if (!updated) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The privacy request could not be read back",
        requestId: request.requestId,
      },
    };
  }
  return { ok: true, value: updated, requestId: request.requestId };
}
