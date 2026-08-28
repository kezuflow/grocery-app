import type {
  AdminDeliveryOperationsRequest,
  AdminFulfillmentQueueRequest,
  AdminOperationsLocationRequest,
  AdminOperationalExceptionsRequest,
  AdminProcurementRequirementsRequest,
  AdminReceivingSessionsRequest,
  DeliveryOperationsSummary,
  FulfillmentModeConfigurationView,
  FulfillmentQueuePage,
  OperationalExceptionPage,
  ProcurementRequirementPage,
  ReceivingSessionPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { listOperationalExceptions as listExceptionRows } from "../../audit/application/list-operational-exceptions";
import {
  listDeliveryDispatch,
  allowedDeliveryActions,
} from "../../delivery/application/list-delivery-dispatch";
import {
  allowedFulfillmentActions,
  listFulfillmentQueue as listFulfillmentRows,
} from "../../fulfillment/application/list-fulfillment-queue";
import {
  getLocationMode,
  type LocationModeView,
} from "../../fulfillment/application/location-mode";
import { listProcurementQueue } from "../../procurement/application/list-procurement-queue";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
} from "./staff-administration-access";

function modeView(value: LocationModeView): FulfillmentModeConfigurationView {
  return value;
}

function pageRequest(request: {
  cursor?: string;
  limit?: number;
  requestId: string;
}): { limit: number; cursorId?: string } | RpcResult<never> {
  const limit = boundListLimit(request.limit);
  if (limit === "invalid")
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  if (!request.cursor) return { limit };
  const cursor = decodeStaffCursor(request.cursor);
  if (!cursor)
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "cursor is malformed",
        requestId: request.requestId,
      },
    };
  return { limit, cursorId: cursor.id };
}

function isPageError(
  value: { limit: number; cursorId?: string } | RpcResult<never>,
): value is RpcResult<never> {
  return "ok" in value;
}

function nextCursor(hasMore: boolean, id: string | undefined): string | null {
  return hasMore && id ? encodeStaffCursor({ createdAt: 0, id }) : null;
}

export async function getAdminFulfillmentMode(
  deps: OperationsAdministrationDeps,
  request: AdminOperationsLocationRequest,
): Promise<RpcResult<FulfillmentModeConfigurationView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "fulfillment.read",
    request.locationId,
  );
  if (!access.ok) return access;
  const mode = await getLocationMode(deps.db, request);
  if (!mode.ok) return mode;
  return { ok: true, value: modeView(mode.value), requestId: request.requestId };
}

export async function listAdminProcurementRequirements(
  deps: OperationsAdministrationDeps,
  request: AdminProcurementRequirementsRequest,
): Promise<RpcResult<ProcurementRequirementPage>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "procurement.read",
    request.locationId,
  );
  if (!access.ok) return access;
  const page = pageRequest(request);
  if (isPageError(page)) return page;
  const rows = await listProcurementQueue(deps.db, {
    locationId: request.locationId,
    cycleId: request.cycleId,
    cursorId: page.cursorId,
    limit: page.limit + 1,
  });
  const pageRows = rows.slice(0, page.limit);
  return {
    ok: true,
    value: {
      items: pageRows.map((row) => ({
        requirementId: row.requirementId,
        cycleId: row.cycleId,
        locationId: row.locationId,
        inventoryPoolId: row.inventoryPoolId,
        requiredQuantityBase: row.requiredQuantityBase,
        acceptedBase: row.acceptedBase,
        rejectedBase: row.rejectedBase,
        status: row.requirementStatus,
        version: row.requirementVersion,
      })),
      nextCursor: nextCursor(rows.length > page.limit, pageRows.at(-1)?.requirementId),
    },
    requestId: request.requestId,
  };
}

export async function listAdminReceivingSessions(
  deps: OperationsAdministrationDeps,
  request: AdminReceivingSessionsRequest,
): Promise<RpcResult<ReceivingSessionPage>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "receiving.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const page = pageRequest(request);
  if (isPageError(page)) return page;
  const rows = await listProcurementQueue(deps.db, {
    locationId: request.locationId,
    cycleId: request.cycleId,
    cursorId: page.cursorId,
    limit: page.limit + 1,
    receivingOnly: true,
  });
  const pageRows = rows.slice(0, page.limit);
  return {
    ok: true,
    value: {
      items: pageRows.map((row) => ({
        receivingSessionId: row.receivingRecordId!,
        requirementId: row.requirementId,
        cycleId: row.cycleId,
        locationId: row.locationId,
        expectedBase: row.requiredQuantityBase,
        acceptedBase: row.acceptedBase,
        rejectedBase: row.rejectedBase,
        status: row.receivingStatus!,
        version: row.receivingVersion!,
      })),
      nextCursor: nextCursor(rows.length > page.limit, pageRows.at(-1)?.requirementId),
    },
    requestId: request.requestId,
  };
}

export async function listAdminFulfillmentQueue(
  deps: OperationsAdministrationDeps,
  request: AdminFulfillmentQueueRequest,
): Promise<RpcResult<FulfillmentQueuePage>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "fulfillment.read",
    request.locationId,
  );
  if (!access.ok) return access;
  const page = pageRequest(request);
  if (isPageError(page)) return page;
  const rows = await listFulfillmentRows(deps.db, {
    locationId: request.locationId,
    cycleId: request.cycleId,
    cursorId: page.cursorId,
    limit: page.limit + 1,
  });
  const pageRows = rows.slice(0, page.limit);
  return {
    ok: true,
    value: {
      items: pageRows.map((row) => ({
        orderId: row.orderId,
        cycleId: row.cycleId,
        locationId: row.locationId,
        status: row.status,
        version: row.version,
        allowedActions: allowedFulfillmentActions(row.status),
      })),
      nextCursor: nextCursor(rows.length > page.limit, pageRows.at(-1)?.orderId),
    },
    requestId: request.requestId,
  };
}

export async function listAdminDeliveryOperations(
  deps: OperationsAdministrationDeps,
  request: AdminDeliveryOperationsRequest,
): Promise<RpcResult<DeliveryOperationsSummary>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.read",
    request.locationId,
  );
  if (!access.ok) return access;
  const page = pageRequest(request);
  if (isPageError(page)) return page;
  const rows = await listDeliveryDispatch(deps.db, {
    locationId: request.locationId,
    cycleId: request.cycleId,
    cursorId: page.cursorId,
    limit: page.limit + 1,
  });
  const pageRows = rows.slice(0, page.limit);
  const items = pageRows.map((row) => ({
    jobId: row.jobId,
    orderId: row.orderId,
    cycleId: row.cycleId,
    locationId: request.locationId,
    status: row.status,
    riderAssigned: row.riderAuthUserId !== null,
    deliveredAtIso: row.deliveredAtIso,
    version: row.version,
    allowedActions: allowedDeliveryActions(row.status, row.riderAuthUserId !== null),
  }));
  const clauses = ["f.location_id=?", "d.status NOT IN ('CANCELED','DELIVERED')"];
  const binds: unknown[] = [request.locationId];
  if (request.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(request.cycleId);
  }
  const totals = await deps.db
    .prepare(
      `SELECT COUNT(*) AS totalOpenJobs, SUM(CASE WHEN d.rider_user_id IS NOT NULL THEN 1 ELSE 0 END) AS assignedJobs FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id LEFT JOIN grocery_order o ON o.id=d.order_id WHERE ${clauses.join(" AND ")}`,
    )
    .bind(...binds)
    .first<{ totalOpenJobs: number; assignedJobs: number | null }>();
  return {
    ok: true,
    value: {
      locationId: request.locationId,
      cycleId: request.cycleId ?? null,
      status: (totals?.totalOpenJobs ?? 0) > 0 ? "OPEN" : "EMPTY",
      totalOpenJobs: totals?.totalOpenJobs ?? 0,
      assignedJobs: totals?.assignedJobs ?? 0,
      items,
      nextCursor: nextCursor(rows.length > page.limit, pageRows.at(-1)?.jobId),
    },
    requestId: request.requestId,
  };
}

export async function listAdminOperationalExceptions(
  deps: OperationsAdministrationDeps,
  request: AdminOperationalExceptionsRequest,
): Promise<RpcResult<OperationalExceptionPage>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "fulfillment.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const page = pageRequest(request);
  if (isPageError(page)) return page;
  const all = (await listExceptionRows(deps.db, { locationId: request.locationId }))
    .filter((item) => !page.cursorId || item.referenceId < page.cursorId)
    .sort((left, right) => right.referenceId.localeCompare(left.referenceId));
  const items = all.slice(0, page.limit);
  return {
    ok: true,
    value: {
      items,
      nextCursor: nextCursor(all.length > page.limit, items.at(-1)?.referenceId),
    },
    requestId: request.requestId,
  };
}
