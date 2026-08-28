import type {
  AdminPromotionDetailRequest,
  AdminPromotionListRequest,
  AdminPromotionPage,
  AdminPromotionPreviewRequest,
  AdminPromotionPreviewView,
  AdminPromotionRedemptionPage,
  AdminPromotionSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolvePromotionAdministrationAccess,
  type PromotionAdministrationDeps,
} from "./promotion-administration-access";

type PromotionRow = {
  promotionId: string;
  code: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
  benefitType: string;
  discountMinor: number | null;
  percent: number | null;
  minimumMinor: number;
  startsAt: number;
  endsAt: number | null;
  globalUsageLimit: number | null;
  perCustomerUsageLimit: number | null;
  automatic: number;
  priority: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};

const PROMOTION_SELECT = `
  SELECT id AS promotionId, code, name, description, status,
         benefit_type AS benefitType, discount_minor AS discountMinor, percent,
         minimum_minor AS minimumMinor, starts_at AS startsAt, ends_at AS endsAt,
         global_usage_limit AS globalUsageLimit, per_customer_usage_limit AS perCustomerUsageLimit,
         automatic, priority, version, created_at AS createdAt, updated_at AS updatedAt
  FROM promotion`;

export function toPromotionSummary(row: PromotionRow): AdminPromotionSummary {
  return {
    promotionId: row.promotionId,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    benefitType: row.benefitType as AdminPromotionSummary["benefitType"],
    discountMinor: row.discountMinor,
    percent: row.percent,
    minimumMinor: row.minimumMinor,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: row.endsAt === null ? null : new Date(row.endsAt).toISOString(),
    globalUsageLimit: row.globalUsageLimit,
    perCustomerUsageLimit: row.perCustomerUsageLimit,
    automatic: row.automatic === 1,
    priority: row.priority,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function readPromotionDetail(
  deps: PromotionAdministrationDeps,
  promotionId: string,
  requestId: string,
): Promise<RpcResult<AdminPromotionSummary>> {
  const row = await deps.db
    .prepare(`${PROMOTION_SELECT} WHERE id = ?`)
    .bind(promotionId)
    .first<PromotionRow>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Promotion not found", requestId },
    };
  }
  return { ok: true, value: toPromotionSummary(row), requestId };
}

/** Bounded keyset listing of promotion definitions, newest first. */
export async function listAdminPromotions(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionListRequest,
): Promise<RpcResult<AdminPromotionPage>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
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
    .prepare(`${PROMOTION_SELECT} ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<PromotionRow>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map(toPromotionSummary);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.promotionId }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** One promotion definition for global promotion readers. */
export async function getAdminPromotion(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionDetailRequest,
): Promise<RpcResult<AdminPromotionSummary>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;
  return readPromotionDetail(deps, request.promotionId, request.requestId);
}

/**
 * Read-only preview applying the same closed policy a Quote would: status,
 * window, minimum subtotal, then deterministic fixed/percent computation
 * capped at the subtotal. Nothing is claimed, written, or redeemed.
 */
export async function previewAdminPromotion(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionPreviewRequest,
): Promise<RpcResult<AdminPromotionPreviewView>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;
  if (!Number.isInteger(request.subtotalMinor) || request.subtotalMinor < 0) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "subtotalMinor must be a non-negative integer",
        requestId: request.requestId,
      },
    };
  }

  const row = await deps.db
    .prepare(`${PROMOTION_SELECT} WHERE id = ?`)
    .bind(request.promotionId)
    .first<PromotionRow>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Promotion not found", requestId: request.requestId },
    };
  }

  const now = Date.now();
  if (row.status !== "ACTIVE") {
    return {
      ok: true,
      value: { eligible: false, reasonCode: "PROMOTION_INACTIVE", discountMinor: null },
      requestId: request.requestId,
    };
  }
  if (row.startsAt > now) {
    return {
      ok: true,
      value: { eligible: false, reasonCode: "PROMOTION_NOT_STARTED", discountMinor: null },
      requestId: request.requestId,
    };
  }
  if (row.endsAt !== null && row.endsAt < now) {
    return {
      ok: true,
      value: { eligible: false, reasonCode: "PROMOTION_EXPIRED", discountMinor: null },
      requestId: request.requestId,
    };
  }
  if (request.subtotalMinor < row.minimumMinor) {
    return {
      ok: true,
      value: { eligible: false, reasonCode: "MINIMUM_ORDER_NOT_MET", discountMinor: null },
      requestId: request.requestId,
    };
  }

  let discountMinor: number;
  if (row.benefitType === "ORDER_PERCENT_DISCOUNT") {
    discountMinor = Math.min(
      Math.ceil((request.subtotalMinor * (row.percent ?? 0)) / 100),
      request.subtotalMinor,
    );
  } else {
    discountMinor = Math.min(row.discountMinor ?? 0, request.subtotalMinor);
  }
  return {
    ok: true,
    value: { eligible: true, reasonCode: null, discountMinor },
    requestId: request.requestId,
  };
}

type RedemptionRow = {
  id: string;
  customer_id: string;
  benefit_code: string;
  benefit_type: string;
  subject_type: string | null;
  subject_id: string | null;
  redeemed_at: number;
};

/** Read-only redemption inspection for one promotion's code. */
export async function listPromotionRedemptions(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionDetailRequest & { cursor?: string; limit?: number },
): Promise<RpcResult<AdminPromotionRedemptionPage>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;

  const promotion = await deps.db
    .prepare("SELECT code FROM promotion WHERE id = ?")
    .bind(request.promotionId)
    .first<{ code: string }>();
  if (!promotion) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Promotion not found", requestId: request.requestId },
    };
  }

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

  const clauses = ["pr.benefit_code = ?"];
  const binds: unknown[] = [promotion.code];
  if (cursor) {
    clauses.push("(pr.redeemed_at < ? OR (pr.redeemed_at = ? AND pr.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = await deps.db
    .prepare(
      `SELECT pr.id, pr.customer_id, pr.benefit_code, pr.benefit_type,
              pr.subject_type, pr.subject_id, pr.redeemed_at
       FROM promotion_redemption pr
       WHERE ${clauses.join(" AND ")}
       ORDER BY pr.redeemed_at DESC, pr.id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<RedemptionRow>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map((row) => ({
    redemptionId: row.id,
    customerId: row.customer_id,
    benefitCode: row.benefit_code,
    benefitType: row.benefit_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    redeemedAt: new Date(row.redeemed_at).toISOString(),
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.redeemed_at, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}
