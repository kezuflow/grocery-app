import type {
  AdvanceAdminFulfillmentRequest,
  AggregateAdminProcurementDemandRequest,
  CompleteAdminReceivingRequest,
  RecordAdminReceivedLineRequest,
  ResolveAdminOperationalExceptionRequest,
  AuthenticatedRequest,
  RpcResult,
  StartAdminReceivingRequest,
  ActivateGlobalFulfillmentModeRequest,
  GlobalCommerceConfigurationView,
  OpenSellingRequest,
  PauseSellingRequest,
  FulfillmentQueueView,
  ProcurementRequirementView,
  ReceivingSessionView,
} from "@freshmarkets/contracts";
import { advanceFulfillment } from "../../operations/application/advance-fulfillment";
import { createProcurementRequirement } from "../../procurement/application/create-procurement-requirement";
import type { ReceivingResult } from "../../procurement/application/execute-receiving-command";
import { recordReceivedLine } from "../../procurement/application/record-received-line";
import { startReceiving } from "../../procurement/application/start-receiving";
import { completeReceiving } from "../../procurement/application/complete-receiving";
import { allowedFulfillmentActions } from "../../fulfillment/application/list-fulfillment-queue";
import {
  activateGlobalFulfillmentMode,
  openSelling,
  pauseSelling,
} from "../../commerce/application/global-commerce-configuration";
import {
  resolveGlobalFulfillmentAdministrationAccess,
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

function failed(
  code: "VALIDATION_FAILED" | "NOT_FOUND" | "ILLEGAL_TRANSITION",
  message: string,
  requestId: string,
) {
  return { ok: false as const, error: { code, message, requestId } };
}

async function access(
  deps: OperationsAdministrationDeps,
  request: AuthenticatedRequest & { locationId: string },
  capability: "procurement.manage" | "fulfillment.manage" | "delivery.manage",
) {
  return resolveOperationsAdministrationAccess(deps, request, capability, request.locationId);
}

function receivingCommandView(result: ReceivingResult): ReceivingSessionView {
  return {
    receivingSessionId: result.receivingRecordId,
    requirementId: result.requirementId,
    cycleId: result.cycleId,
    locationId: result.locationId,
    expectedBase: result.expectedBase,
    acceptedBase: result.acceptedBase,
    rejectedBase: result.rejectedBase,
    status: result.status,
    version: result.version,
    legacyAcceptedBase: result.legacyAcceptedBase,
  };
}

async function loadReceiving(database: D1Database, id: string) {
  return database
    .prepare(`SELECT rr.id, rr.procurement_requirement_id, pr.delivery_cycle_id, pr.location_id,
    rr.expected_quantity, rr.accepted_quantity, rr.rejected_quantity, rr.status, rr.version
    FROM receiving_record rr JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id WHERE rr.id=?`)
    .bind(id)
    .first<{
      id: string;
      procurement_requirement_id: string;
      delivery_cycle_id: string;
      location_id: string;
      expected_quantity: number;
      accepted_quantity: number;
      rejected_quantity: number;
      status: string;
      version: number;
    }>();
}

async function runCommerceConfigurationCommand(
  deps: OperationsAdministrationDeps,
  request: PauseSellingRequest | OpenSellingRequest | ActivateGlobalFulfillmentModeRequest,
  command: (actor: { staffId: string; authUserId: string }) => Promise<
    | { ok: true; value: GlobalCommerceConfigurationView; requestId: string }
    | {
        ok: false;
        error: {
          code: import("@freshmarkets/contracts").AppErrorCode;
          message: string;
          requestId: string;
        };
      }
  >,
): Promise<RpcResult<GlobalCommerceConfigurationView>> {
  const permitted = await resolveGlobalFulfillmentAdministrationAccess(
    deps,
    request,
    "fulfillment.manage",
  );
  if (!permitted.ok) return permitted;
  return command(permitted.value);
}

export function pauseAdminSelling(
  deps: OperationsAdministrationDeps,
  request: PauseSellingRequest,
): Promise<RpcResult<GlobalCommerceConfigurationView>> {
  return runCommerceConfigurationCommand(deps, request, (actor) =>
    pauseSelling(deps.db, { ...request, actor }),
  );
}

export function activateAdminGlobalMode(
  deps: OperationsAdministrationDeps,
  request: ActivateGlobalFulfillmentModeRequest,
): Promise<RpcResult<GlobalCommerceConfigurationView>> {
  return runCommerceConfigurationCommand(deps, request, (actor) =>
    activateGlobalFulfillmentMode(deps.db, { ...request, actor }),
  );
}

export function openAdminSelling(
  deps: OperationsAdministrationDeps,
  request: OpenSellingRequest,
): Promise<RpcResult<GlobalCommerceConfigurationView>> {
  return runCommerceConfigurationCommand(deps, request, (actor) =>
    openSelling(deps.db, { ...request, actor }),
  );
}

export async function aggregateAdminProcurementDemand(
  deps: OperationsAdministrationDeps,
  request: AggregateAdminProcurementDemandRequest,
): Promise<RpcResult<ProcurementRequirementView>> {
  const permitted = await access(deps, request, "procurement.manage");
  if (!permitted.ok) return permitted;
  const result = await createProcurementRequirement(
    deps.db,
    {
      requestId: request.requestId,
      headers: request.headers,
      deliveryCycleId: request.cycleId,
      locationId: request.locationId,
      inventoryPoolId: request.inventoryPoolId,
      skuId: request.skuId,
      expectedVersion: request.expectedVersion,
      idempotencyKey: request.idempotencyKey,
    },
    { actorAuthUserId: permitted.value.authUserId, reason: request.reason },
  );
  if (!result.ok) return result;
  return { ok: true, value: result.value.view, requestId: request.requestId };
}

export async function startAdminReceiving(
  deps: OperationsAdministrationDeps,
  request: StartAdminReceivingRequest,
): Promise<RpcResult<ReceivingSessionView>> {
  const permitted = await access(deps, request, "procurement.manage");
  if (!permitted.ok) return permitted;
  const owner = await deps.db
    .prepare("SELECT location_id FROM procurement_requirement WHERE id=?")
    .bind(request.requirementId)
    .first<{ location_id: string }>();
  if (!owner || owner.location_id !== request.locationId)
    return failed(
      "NOT_FOUND",
      "Receiving requirement not found at this location",
      request.requestId,
    );
  const result = await startReceiving(deps.db, {
    requirementId: request.requirementId,
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
    actorId: permitted.value.authUserId,
    requestId: request.requestId,
    authority: { authUserId: permitted.value.authUserId, locationId: request.locationId },
    reason: request.reason,
  });
  if (!result.ok)
    return {
      ok: false,
      error: {
        code: result.error.code as import("@freshmarkets/contracts").AppErrorCode,
        message: result.error.message,
        requestId: request.requestId,
      },
    };
  return { ok: true, requestId: request.requestId, value: receivingCommandView(result.value) };
}

export async function recordAdminReceivedLine(
  deps: OperationsAdministrationDeps,
  request: RecordAdminReceivedLineRequest,
): Promise<RpcResult<ReceivingSessionView>> {
  const permitted = await access(deps, request, "procurement.manage");
  if (!permitted.ok) return permitted;
  const before = await loadReceiving(deps.db, request.receivingSessionId);
  if (!before || before.location_id !== request.locationId)
    return failed("NOT_FOUND", "Receiving session not found at this location", request.requestId);
  const result = await recordReceivedLine(deps.db, {
    receivingRecordId: request.receivingSessionId,
    acceptedDeltaBase: request.acceptedBase,
    rejectedDeltaBase: request.rejectedBase,
    reason: request.reason ?? "ADMIN_RECEIPT",
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
    actorId: permitted.value.authUserId,
    requestId: request.requestId,
    authority: { authUserId: permitted.value.authUserId, locationId: request.locationId },
  });
  if (!result.ok)
    return {
      ok: false,
      error: {
        code: result.error.code as import("@freshmarkets/contracts").AppErrorCode,
        message: result.error.message,
        requestId: request.requestId,
      },
    };
  return { ok: true, requestId: request.requestId, value: receivingCommandView(result.value) };
}

export async function completeAdminReceiving(
  deps: OperationsAdministrationDeps,
  request: CompleteAdminReceivingRequest,
): Promise<RpcResult<ReceivingSessionView>> {
  const permitted = await access(deps, request, "procurement.manage");
  if (!permitted.ok) return permitted;
  const row = await loadReceiving(deps.db, request.receivingSessionId);
  if (!row || row.location_id !== request.locationId)
    return failed("NOT_FOUND", "Receiving session not found at this location", request.requestId);
  const result = await completeReceiving(deps.db, {
    receivingRecordId: row.id,
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
    requestId: request.requestId,
    authority: { authUserId: permitted.value.authUserId, locationId: request.locationId },
    reason: request.reason,
  });
  if (!result.ok)
    return {
      ok: false,
      error: {
        code: result.error.code as import("@freshmarkets/contracts").AppErrorCode,
        message: result.error.message,
        requestId: request.requestId,
      },
    };
  return { ok: true, requestId: request.requestId, value: receivingCommandView(result.value) };
}

export async function advanceAdminFulfillment(
  deps: OperationsAdministrationDeps,
  request: AdvanceAdminFulfillmentRequest,
): Promise<RpcResult<FulfillmentQueueView>> {
  const permitted = await access(deps, request, "fulfillment.manage");
  if (!permitted.ok) return permitted;
  const result = await advanceFulfillment(
    deps.db,
    {
      requestId: request.requestId,
      headers: request.headers,
      orderId: request.orderId,
      action: request.action,
      expectedVersion: request.expectedVersion,
      idempotencyKey: request.idempotencyKey,
    },
    {
      authorize: async (locationId) => locationId === request.locationId,
      actorAuthUserId: permitted.value.authUserId,
      reason: request.reason,
    },
  );
  if (!result.ok)
    return {
      ok: false,
      error: {
        code: result.error.code as import("@freshmarkets/contracts").AppErrorCode,
        message: result.error.message,
        requestId: request.requestId,
      },
    };
  return {
    ok: true,
    value: {
      orderId: request.orderId,
      cycleId: result.value.cycleId,
      locationId: result.value.locationId,
      status: result.value.status,
      version: result.value.version,
      allowedActions: allowedFulfillmentActions(result.value.status),
    },
    requestId: request.requestId,
  };
}

export async function resolveAdminOperationalException(
  deps: OperationsAdministrationDeps,
  request: ResolveAdminOperationalExceptionRequest,
): Promise<RpcResult<FulfillmentQueueView>> {
  if (request.reason.trim() === "")
    return failed("VALIDATION_FAILED", "A resolution reason is required", request.requestId);
  if (request.kind === "FULFILLMENT_SHORTAGE" && request.action === "RETRY_FULFILLMENT")
    return advanceAdminFulfillment(deps, { ...request, action: "RESUME_PICKING" });
  return failed(
    "VALIDATION_FAILED",
    "Exception action is not supported for this source",
    request.requestId,
  );
}
