import type {
  AdminDeliveryOperationsRequest,
  AdminFulfillmentQueueRequest,
  AdminOperationsLocationRequest,
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
import { getLocationMode } from "../../fulfillment/application/location-mode";
import { listProcurementQueue } from "../../procurement/application/list-procurement-queue";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

function modeView(
  value: Awaited<ReturnType<typeof getLocationMode>>["value"],
): FulfillmentModeConfigurationView {
  return { ...value, cadence: null };
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
  const rows = await listProcurementQueue(deps.db, { locationId: request.locationId });
  return {
    ok: true,
    value: {
      items: rows
        .filter((row) => !request.cycleId || row.cycleId === request.cycleId)
        .map((row) => ({
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
      nextCursor: null,
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
  const rows = await listProcurementQueue(deps.db, { locationId: request.locationId });
  return {
    ok: true,
    value: {
      items: rows
        .filter(
          (row) =>
            row.receivingRecordId !== null && (!request.cycleId || row.cycleId === request.cycleId),
        )
        .map((row) => ({
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
      nextCursor: null,
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
  const rows = await listFulfillmentRows(deps.db, { locationId: request.locationId });
  return {
    ok: true,
    value: {
      items: rows
        .filter((row) => !request.cycleId || row.cycleId === request.cycleId)
        .map((row) => ({
          orderId: row.orderId,
          cycleId: row.cycleId,
          locationId: row.locationId,
          status: row.status,
          version: row.version,
          allowedActions: allowedFulfillmentActions(row.status),
        })),
      nextCursor: null,
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
  const rows = await listDeliveryDispatch(deps.db, { locationId: request.locationId });
  const filtered = rows
    .filter((row) => !request.cycleId || row.cycleId === request.cycleId)
    .map((row) => ({
      ...row,
      allowedActions: allowedDeliveryActions(row.status, row.riderAuthUserId !== null),
    }));
  return {
    ok: true,
    value: {
      locationId: request.locationId,
      cycleId: request.cycleId ?? null,
      status: filtered.length ? "OPEN" : "EMPTY",
      totalOpenJobs: filtered.length,
      assignedJobs: filtered.filter((item) => item.riderAuthUserId !== null).length,
      items: filtered,
    },
    requestId: request.requestId,
  };
}

export async function listAdminOperationalExceptions(
  deps: OperationsAdministrationDeps,
  request: AdminOperationsLocationRequest,
): Promise<RpcResult<OperationalExceptionPage>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "fulfillment.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  return {
    ok: true,
    value: {
      items: await listExceptionRows(deps.db, { locationId: request.locationId }),
      nextCursor: null,
    },
    requestId: request.requestId,
  };
}
