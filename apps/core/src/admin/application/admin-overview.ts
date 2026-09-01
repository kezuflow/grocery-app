import { drizzle } from "drizzle-orm/d1";
import type {
  AdminOverviewCard,
  AdminOverviewRequest,
  AdminOverviewView,
  Capability,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  hasOperationalScope,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { listAdminAuditEvents } from "../../audit/application/list-audit-events";
import { listOperationalExceptionsForLocations } from "../../audit/application/list-operational-exceptions";
import { iamSchema } from "../../iam/schema";
import { setD1SpanAttributes, traceOperation } from "../../observability";

export type AdminOverviewDeps = {
  auth: AuthInstance;
  db: D1Database;
  accessContext?: ResolvedApplicationContext;
};

function failure(
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED",
  message: string,
  requestId: string,
) {
  return { ok: false as const, error: { code, message, requestId } };
}

function hasAny(capabilities: ReadonlyArray<Capability>, required: ReadonlyArray<Capability>) {
  return required.some((capability) => capabilities.includes(capability));
}

function placeholders(values: ReadonlyArray<string>): string {
  return values.map(() => "?").join(",");
}

/** Core-owned operational command center projection with explicit section denials. */
export async function getAdminOverview(
  deps: AdminOverviewDeps,
  request: AdminOverviewRequest,
): Promise<RpcResult<AdminOverviewView>> {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: request.timezone }).format();
  } catch {
    return failure(
      "VALIDATION_FAILED",
      "timezone must be a valid IANA timezone",
      request.requestId,
    );
  }

  const context = await applicationContextForRequest(
    deps.auth,
    drizzle(deps.db, { schema: iamSchema }),
    request,
    deps.accessContext,
  );
  if (!context.ok) return context;
  if (!context.value.authenticated || !context.value.principal) {
    return failure("UNAUTHENTICATED", "Authentication is required", request.requestId);
  }
  if (context.value.scopes.length === 0) {
    return failure("FORBIDDEN", "Active Staff scope is required", request.requestId);
  }

  let locations: ReadonlyArray<{ locationId: string; marketId: string }> = [];
  const selected = request.selectedScope;
  if (selected.kind === "GLOBAL") {
    if (!context.value.scopes.some((scope) => scope.kind === "global")) {
      return failure("FORBIDDEN", "Global Admin scope is required", request.requestId);
    }
    const rows = await traceOperation(
      "db.admin.overview.locations",
      { requestId: request.requestId, readModel: "admin.overview" },
      async (span) => {
        const result = await deps.db
          .prepare(
            "SELECT id AS locationId, market_id AS marketId FROM fulfillment_location WHERE status='active' ORDER BY id",
          )
          .all<{ locationId: string; marketId: string }>();
        setD1SpanAttributes(span, result.meta);
        span.setAttribute("db.rows.returned", result.results.length);
        return result;
      },
    );
    locations = rows.results;
  } else if (selected.kind === "MARKET") {
    const market = await deps.db
      .prepare("SELECT id FROM market WHERE id=? AND status='active'")
      .bind(selected.marketId)
      .first<{ id: string }>();
    if (!market) return failure("NOT_FOUND", "Active market not found", request.requestId);
    if (
      !context.value.scopes.some(
        (scope) =>
          scope.kind === "global" ||
          (scope.kind === "market" && scope.marketId === selected.marketId),
      )
    ) {
      return failure("FORBIDDEN", "Selected market scope is required", request.requestId);
    }
    const rows = await traceOperation(
      "db.admin.overview.locations",
      { requestId: request.requestId, readModel: "admin.overview" },
      async (span) => {
        const result = await deps.db
          .prepare(
            "SELECT id AS locationId, market_id AS marketId FROM fulfillment_location WHERE status='active' AND market_id=? ORDER BY id",
          )
          .bind(selected.marketId)
          .all<{ locationId: string; marketId: string }>();
        setD1SpanAttributes(span, result.meta);
        span.setAttribute("db.rows.returned", result.results.length);
        return result;
      },
    );
    locations = rows.results;
  } else {
    const location = await deps.db
      .prepare(
        "SELECT id AS locationId, market_id AS marketId FROM fulfillment_location WHERE id=? AND status='active'",
      )
      .bind(selected.locationId)
      .first<{ locationId: string; marketId: string }>();
    if (!location)
      return failure("NOT_FOUND", "Active fulfillment location not found", request.requestId);
    if (location.marketId !== selected.marketId) {
      return failure(
        "VALIDATION_FAILED",
        "Selected location does not belong to the selected market",
        request.requestId,
      );
    }
    if (!hasOperationalScope(context.value.scopes, location.locationId, location.marketId)) {
      return failure("FORBIDDEN", "Selected location scope is required", request.requestId);
    }
    locations = [location];
  }

  const capabilities = context.value.capabilities;
  const isGlobal = selected.kind === "GLOBAL";
  const canReadOrders = isGlobal && hasAny(capabilities, ["orders.read", "orders.manage"]);
  const canReadPayments = isGlobal && hasAny(capabilities, ["payments.read", "payments.manage"]);
  const canReadCatalog = isGlobal && hasAny(capabilities, ["catalog.read", "catalog.manage"]);
  const canReadOperations = hasAny(capabilities, [
    "procurement.read",
    "procurement.manage",
    "fulfillment.read",
    "fulfillment.manage",
    "delivery.read",
    "delivery.manage",
  ]);
  const canReadExceptions = capabilities.includes("fulfillment.manage");
  const canReadAudit = capabilities.includes("audit.read");
  const deniedSections = [
    ...(!canReadOrders ? ["orders"] : []),
    ...(!canReadPayments ? ["payments"] : []),
    ...(!canReadCatalog ? ["catalog"] : []),
    ...(!canReadOperations ? ["operations"] : []),
    ...(!canReadAudit ? ["audit"] : []),
  ];
  const locationIds = locations.map((row) => row.locationId);

  const [openOrders, actionRequiredPayments, activeProducts] = await Promise.all([
    canReadOrders
      ? deps.db
          .prepare(
            "SELECT COUNT(*) AS count FROM grocery_order WHERE status NOT IN ('DELIVERED','CANCELED','EXPIRED')",
          )
          .first<{ count: number }>()
      : Promise.resolve(null),
    canReadPayments
      ? deps.db
          .prepare("SELECT COUNT(*) AS count FROM payment_intent WHERE status='REQUIRES_ACTION'")
          .first<{ count: number }>()
      : Promise.resolve(null),
    canReadCatalog
      ? deps.db
          .prepare("SELECT COUNT(*) AS count FROM product WHERE status='active'")
          .first<{ count: number }>()
      : Promise.resolve(null),
  ]);

  const exceptions =
    canReadExceptions && locationIds.length > 0
      ? (await listOperationalExceptionsForLocations(deps.db, { locationIds, limit: 12 })).map(
          ({ queueKey: _queueKey, ...item }) => ({ ...item, href: "/admin/exceptions" }),
        )
      : [];

  let openExceptionCount: number | null = null;
  let workloadStages: AdminOverviewView["workloadStages"] = [];
  if (canReadOperations && locationIds.length > 0) {
    const marks = placeholders(locationIds);
    const workload = await traceOperation(
      "db.admin.overview.workload",
      { requestId: request.requestId, readModel: "admin.overview" },
      async (span) => {
        const result = await deps.db
          .prepare(
            `SELECT status AS code, COUNT(*) AS count FROM fulfillment_record
             WHERE location_id IN (${marks}) GROUP BY status ORDER BY status`,
          )
          .bind(...locationIds)
          .all<{ code: string; count: number }>();
        setD1SpanAttributes(span, result.meta);
        span.setAttribute("db.rows.returned", result.results.length);
        return result;
      },
    );
    workloadStages = workload.results.map((row) => ({
      code: row.code,
      label: row.code.toLowerCase().replaceAll("_", " "),
      count: row.count,
    }));
  }
  if (canReadExceptions && locationIds.length > 0) {
    const count = await deps.db
      .prepare(
        `WITH selected_locations(location_id) AS (SELECT value FROM json_each(?)),
         open_exceptions AS (
           SELECT se.id FROM supply_exception se
           JOIN procurement_requirement pr ON pr.id=se.requirement_id
           JOIN selected_locations sl ON sl.location_id=pr.location_id
           WHERE se.status NOT IN ('RESOLVED','CLOSED')
           UNION ALL
           SELECT f.id FROM fulfillment_record f
           JOIN selected_locations sl ON sl.location_id=f.location_id
           WHERE f.status='SHORTED'
           UNION ALL
           SELECT d.id FROM delivery_job d
           JOIN fulfillment_record f ON f.order_id=d.order_id
           JOIN selected_locations sl ON sl.location_id=f.location_id
           WHERE d.status='FAILED'
           UNION ALL
           SELECT rr.id FROM receiving_record rr
           JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id
           JOIN selected_locations sl ON sl.location_id=pr.location_id
           WHERE (rr.rejected_quantity>0
                  OR rr.accepted_quantity+rr.rejected_quantity NOT IN (0, rr.expected_quantity))
             AND rr.status!='NOT_STARTED'
         ) SELECT COUNT(*) AS count FROM open_exceptions`,
      )
      .bind(JSON.stringify([...new Set(locationIds)]))
      .first<{ count: number }>();
    openExceptionCount = count?.count ?? 0;
  }

  const cards: AdminOverviewCard[] = [
    {
      code: "OPEN_ORDERS",
      label: "Open orders",
      value: canReadOrders ? (openOrders?.count ?? 0) : null,
      unavailableReason: canReadOrders ? null : "Global orders.read access is required.",
      href: "/admin/orders",
    },
    {
      code: "ACTION_REQUIRED_PAYMENTS",
      label: "Payments requiring action",
      value: canReadPayments ? (actionRequiredPayments?.count ?? 0) : null,
      unavailableReason: canReadPayments ? null : "Global payments.read access is required.",
      href: "/admin/payments",
    },
    {
      code: "OPEN_EXCEPTIONS",
      label: "Open exceptions",
      value: canReadExceptions ? (openExceptionCount ?? 0) : null,
      unavailableReason: canReadExceptions ? null : "fulfillment.manage access is required.",
      href: "/admin/exceptions",
    },
    {
      code: "ACTIVE_PRODUCTS",
      label: "Active products",
      value: canReadCatalog ? (activeProducts?.count ?? 0) : null,
      unavailableReason: canReadCatalog ? null : "Global catalog.read access is required.",
      href: "/admin/catalog/products",
    },
  ];

  const auditRequest = {
    requestId: request.requestId,
    headers: request.headers,
    limit: 8,
    ...(selected.kind === "MARKET" ? { marketId: selected.marketId } : {}),
    ...(selected.kind === "LOCATION"
      ? { marketId: selected.marketId, locationId: selected.locationId }
      : {}),
  };
  const recent = canReadAudit
    ? await listAdminAuditEvents({ ...deps, accessContext: context.value }, auditRequest)
    : null;
  const recentOperations = recent?.ok ? recent.value.items : [];
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    value: {
      generatedAt,
      selectedScope: selected,
      timezone: request.timezone,
      cards,
      workloadStages,
      exceptions,
      recentOperations,
      freshness: {
        computedAt: generatedAt,
        sourceWatermark: recentOperations[0]?.occurredAt ?? null,
      },
      deniedSections,
    },
    requestId: request.requestId,
  };
}
