import { receivingActions } from "../../procurement/application/receiving-actions";
import { latestScheduledCountedReceipts } from "../../procurement/application/scheduled-counted-receipts";
import { listScheduledSurplus } from "../../procurement/application/scheduled-surplus";
import type {
  AdminDeliveryOperationsRequest,
  AdminFulfillmentQueueRequest,
  AdminOperationsLocationRequest,
  AuthenticatedRequest,
  AdminOperationalExceptionsRequest,
  AdminProcurementRequirementsRequest,
  AdminReceivingSessionsRequest,
  DeliveryOperationsSummary,
  GlobalCommerceConfigurationView,
  FulfillmentQueuePage,
  OperationalActivityView,
  OperationalExceptionPage,
  ProcurementRequirementPage,
  ReceivingSessionPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { readAdminNotifications } from "./admin-notifications";
import { listOperationalExceptions as listExceptionRows } from "../../audit/application/list-operational-exceptions";
import { listDeliveryDispatch } from "../../delivery/application/list-delivery-dispatch";
import {
  allowedFulfillmentActions,
  listFulfillmentQueue as listFulfillmentRows,
} from "../../fulfillment/application/list-fulfillment-queue";
import { getGlobalCommerceConfiguration } from "../../commerce/application/global-commerce-configuration";
import { listProcurementQueue } from "../../procurement/application/list-procurement-queue";
import {
  resolveGlobalOperationsAdministrationAccess,
  resolveOperationsAdministrationAnyAccess,
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
} from "./staff-administration-access";

function pageRequest(
  request: {
    cursor?: string;
    limit?: number;
    requestId: string;
  },
  cursorContext?: string,
):
  | {
      limit: number;
      cursor?: { createdAt: number; id: string; context?: string };
      cursorId?: string;
    }
  | RpcResult<never> {
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
  if (!cursor || cursor.context !== cursorContext)
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "cursor is malformed or does not match the current query",
        requestId: request.requestId,
      },
    };
  return { limit, cursor, cursorId: cursor.id };
}

function isPageError(
  value: { limit: number; cursorId?: string } | RpcResult<never>,
): value is RpcResult<never> {
  return "ok" in value;
}

function nextCursor(hasMore: boolean, id: string | undefined): string | null {
  return hasMore && id ? encodeStaffCursor({ createdAt: 0, id }) : null;
}

function fulfillmentCursorContext(request: AdminFulfillmentQueueRequest): string {
  return JSON.stringify([
    "fulfillment",
    request.locationId,
    request.orderId ?? null,
    request.cycleId ?? null,
    request.filter ?? "ALL",
  ]);
}

export async function getAdminGlobalCommerceConfiguration(
  deps: OperationsAdministrationDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<GlobalCommerceConfigurationView>> {
  const access = await resolveGlobalOperationsAdministrationAccess(
    deps,
    request,
    "fulfillment.read",
  );
  if (!access.ok) return access;
  return getGlobalCommerceConfiguration(deps.db, request);
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
        skuId: row.skuId,
        committedQuantitySellable: row.committedQuantitySellable,
        shippingWeightGrams: row.shippingWeightGrams,
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
    "procurement.manage",
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
        productId: row.productId ?? undefined,
        variantName: row.variantName ?? undefined,
        stockTracking: row.stockTracking,
        requirementId: row.requirementId,
        cycleId: row.cycleId,
        locationId: row.locationId,
        expectedBase: row.expectedQuantityBase,
        productName: row.productName,
        cycleName: row.cycleName,
        baseUnit: row.baseUnit,
        allowedActions: receivingActions({
          status: row.receivingStatus ?? "",
          requirementStatus: row.requirementStatus,
          expected: row.expectedQuantityBase,
          accepted: row.acceptedBase,
          rejected: row.rejectedBase,
          shortage: row.shortageBase,
          replacement: row.replacementBase,
          replacementAllowed: row.replacementAllowed,
        }),
        legacyAcceptedBase: row.legacyAcceptedBase,
        resolvedByCancellation: row.resolvedByCancellation,
        shortageBase: row.shortageBase,
        replacementBase: row.replacementBase,
        acceptedBase: row.acceptedBase,
        rejectedBase: row.rejectedBase,
        status: row.receivingStatus!,
        version: row.receivingVersion!,
      })),
      countedReceipts: await latestScheduledCountedReceipts(
        deps.db,
        request.locationId,
        request.cycleId,
      ),
      surplus: await listScheduledSurplus(
        deps.db,
        request.locationId,
        pageRows.map((row) => row.requirementId),
      ),
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
  const cursorContext = fulfillmentCursorContext(request);
  const page = pageRequest(request, cursorContext);
  if (isPageError(page)) return page;
  const rows = await listFulfillmentRows(deps.db, {
    orderId: request.orderId,
    locationId: request.locationId,
    cycleId: request.cycleId,
    filter: request.filter,
    cursor: page.cursor,
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
        allowedActions:
          row.status === "PACKING" &&
          row.operational.fulfillmentMode === "SCHEDULED" &&
          !row.packingGoodsReady
            ? allowedFulfillmentActions(row.status).filter((action) => action !== "MARK_PACKED")
            : allowedFulfillmentActions(row.status),
        operational: row.operational,
      })),
      nextCursor:
        pageRows.at(-1) && rows.length > page.limit
          ? encodeStaffCursor({
              createdAt: pageRows.at(-1)!.sortAt,
              id: pageRows.at(-1)!.orderId,
              context: cursorContext,
            })
          : null,
    },
    requestId: request.requestId,
  };
}

/** Lightweight location feed used by the shared operational refresh owner. */
export async function listAdminOperationalActivity(
  deps: OperationsAdministrationDeps,
  request: AdminOperationsLocationRequest,
): Promise<RpcResult<OperationalActivityView>> {
  const access = await resolveOperationsAdministrationAnyAccess(
    deps,
    request,
    ["fulfillment.read", "delivery.read"],
    request.locationId,
    { concealOutOfScopeLocation: true },
  );
  if (!access.ok) return access;
  const notifications = await readAdminNotifications(deps.db, {
    locationIds: [request.locationId],
    globalView: false,
    globalStaff: false,
    capabilities: access.value.capabilities,
  });
  const first = notifications[0];
  return {
    ok: true,
    value: {
      notifications,
      latest: first ? { occurredAt: first.occurredAt, id: first.id } : null,
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
    orderId: request.orderId,
    actorAuthUserId: access.value.authUserId,
    locationId: request.locationId,
    cycleId: request.cycleId,
    cursor: page.cursor,
    limit: page.limit + 1,
  });
  const pageRows = rows.slice(0, page.limit);
  const items = pageRows.map((row) => ({
    jobId: row.jobId,
    orderId: row.orderId,
    cycleId: row.cycleId,
    locationId: request.locationId,
    fulfillmentMode: row.fulfillmentMode,
    status: row.status,
    externalDispatch:
      row.externalDispatchId && row.externalProvider && row.externalStatus && row.externalVersion
        ? {
            dispatchId: row.externalDispatchId,
            provider: row.externalProvider,
            status: row.externalStatus,
            providerStatus: row.externalProviderStatus,
            trackingUrl: row.externalTrackingUrl,
            providerDeliveryId: row.externalProviderDeliveryId,
            version: row.externalVersion,
          }
        : null,
    manualDelivery: row.manualDelivery,
    manualActions: row.manualActions,
    courierPickup: row.courierPickup,
    canRevisePromise: row.canRevisePromise,
    canInspectReturnedGoods: row.canInspectReturnedGoods,
    deliveredAtIso: row.deliveredAtIso,
    version: row.version,
  }));
  const clauses = ["f.location_id=?", "d.status NOT IN ('CANCELED','DELIVERED')"];
  const binds: unknown[] = [request.locationId];
  if (request.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(request.cycleId);
  }
  const totals = await deps.db
    .prepare(
      `SELECT COUNT(*) AS totalOpenJobs,
              COUNT(CASE WHEN dispatch.status='ACTIVE' THEN 1 END) AS bookedJobs
       FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id
       LEFT JOIN grocery_order o ON o.id=d.order_id
       LEFT JOIN delivery_provider_dispatch dispatch ON dispatch.id=(
         SELECT latest.id FROM delivery_provider_dispatch latest
         WHERE latest.delivery_job_id=d.id
         ORDER BY latest.attempt_sequence DESC LIMIT 1
       )
       WHERE ${clauses.join(" AND ")}`,
    )
    .bind(...binds)
    .first<{ totalOpenJobs: number; bookedJobs: number | null }>();
  return {
    ok: true,
    value: {
      locationId: request.locationId,
      cycleId: request.cycleId ?? null,
      status: (totals?.totalOpenJobs ?? 0) > 0 ? "OPEN" : "EMPTY",
      totalOpenJobs: totals?.totalOpenJobs ?? 0,
      bookedJobs: totals?.bookedJobs ?? 0,
      items,
      nextCursor:
        pageRows.at(-1) && rows.length > page.limit
          ? encodeStaffCursor({ createdAt: pageRows.at(-1)!.sortAt, id: pageRows.at(-1)!.jobId })
          : null,
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
  const all = await listExceptionRows(deps.db, {
    locationId: request.locationId,
    cursorKey: page.cursorId,
    limit: page.limit + 1,
  });
  const ordered = all;
  const pageRows = ordered.slice(0, page.limit);
  const items = pageRows.map(({ queueKey: _queueKey, ...item }) => item);
  return {
    ok: true,
    value: {
      items,
      nextCursor: nextCursor(ordered.length > page.limit, pageRows.at(-1)?.queueKey),
    },
    requestId: request.requestId,
  };
}
