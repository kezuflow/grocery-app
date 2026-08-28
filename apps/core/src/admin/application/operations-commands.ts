import type {
  AdvanceAdminDeliveryRequest,
  AdvanceAdminFulfillmentRequest,
  AggregateAdminProcurementDemandRequest,
  CompleteAdminReceivingRequest,
  RecordAdminReceivedLineRequest,
  ResolveAdminOperationalExceptionRequest,
  AuthenticatedRequest,
  RpcResult,
  StartAdminReceivingRequest,
  ActivateFulfillmentModeRequest,
  AdminDeliveryOperationView,
  FulfillmentModeConfigurationView,
  FulfillmentQueueView,
  ProcurementRequirementView,
  ReceivingSessionView,
} from "@freshmarkets/contracts";
import { appendAuditEvent } from "../../audit/application/append-audit-event";
import { advanceDelivery } from "../../operations/application/advance-delivery";
import { advanceFulfillment } from "../../operations/application/advance-fulfillment";
import { createProcurementRequirement } from "../../procurement/application/create-procurement-requirement";
import { recordReceivedLine } from "../../procurement/application/record-received-line";
import { startReceiving } from "../../procurement/application/start-receiving";
import { completeReceiving } from "../../procurement/application/complete-receiving";
import { setFulfillmentLocationMode } from "../../fulfillment/application/location-mode";
import {
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

async function audit(
  deps: OperationsAdministrationDeps,
  input: { requestId: string; reason?: string; idempotencyKey?: string },
  actorUserId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  locationId: string,
  after: Record<string, unknown>,
) {
  if (input.idempotencyKey) {
    const existing = await deps.db
      .prepare("SELECT id FROM audit_event WHERE action=? AND idempotency_key=? LIMIT 1")
      .bind(action, input.idempotencyKey)
      .first<{ id: string }>();
    if (existing) return;
  }
  const appended = await appendAuditEvent(deps.db, {
    actorUserId,
    action,
    resourceType,
    resourceId,
    reason: input.reason?.trim() || null,
    details: { locationId },
    idempotencyKey: input.idempotencyKey ?? null,
    after,
    correlationId: input.requestId,
    occurredAt: Date.now(),
  });
  if (!appended) throw new Error(`Audit append failed for ${action}`);
}

async function access(
  deps: OperationsAdministrationDeps,
  request: AuthenticatedRequest & { locationId: string },
  capability: "procurement.manage" | "receiving.manage" | "fulfillment.manage" | "delivery.manage",
) {
  return resolveOperationsAdministrationAccess(
    deps,
    request,
    capability as never,
    request.locationId,
  );
}

function receivingView(row: {
  id: string;
  procurement_requirement_id: string;
  delivery_cycle_id: string;
  location_id: string;
  expected_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  status: string;
  version: number;
}): ReceivingSessionView {
  return {
    receivingSessionId: row.id,
    requirementId: row.procurement_requirement_id,
    cycleId: row.delivery_cycle_id,
    locationId: row.location_id,
    expectedBase: row.expected_quantity,
    acceptedBase: row.accepted_quantity,
    rejectedBase: row.rejected_quantity,
    status: row.status,
    version: row.version,
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

export async function activateAdminFulfillmentMode(
  deps: OperationsAdministrationDeps,
  request: ActivateFulfillmentModeRequest,
): Promise<RpcResult<FulfillmentModeConfigurationView>> {
  const permitted = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "fulfillment.manage",
    request.locationId,
  );
  if (!permitted.ok) return permitted;
  const result = await setFulfillmentLocationMode(deps.db, {
    locationId: request.locationId,
    activeMode: request.fulfillmentMode,
    cadence: request.cadence ?? null,
    promiseMinutes: request.promiseMinutes ?? null,
    maxConcurrentInstantOrders: request.maxConcurrentInstantOrders ?? null,
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
    requestId: request.requestId,
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
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.FULFILLMENT_MODE_ACTIVATED",
    "fulfillment_location_mode",
    request.locationId,
    request.locationId,
    { activeMode: result.value.activeMode, version: result.value.version },
  );
  return result;
}

export async function aggregateAdminProcurementDemand(
  deps: OperationsAdministrationDeps,
  request: AggregateAdminProcurementDemandRequest,
): Promise<RpcResult<ProcurementRequirementView>> {
  const permitted = await access(deps, request, "procurement.manage");
  if (!permitted.ok) return permitted;
  // The canonical requirement command owns this idempotency record. Resolve
  // its successful replay before deriving availability, which now includes the
  // requirement created by the original invocation.
  const replay = await deps.db
    .prepare(
      "SELECT status, result_reference FROM idempotency_records WHERE scope='procurement.createRequirement' AND idempotency_key=?",
    )
    .bind(request.idempotencyKey)
    .first<{ status: string; result_reference: string | null }>();
  if (replay?.status === "SUCCEEDED" && replay.result_reference) {
    const prior = await deps.db
      .prepare("SELECT required_quantity, status, version FROM procurement_requirement WHERE id=?")
      .bind(replay.result_reference)
      .first<{ required_quantity: number; status: string; version: number }>();
    if (prior)
      return {
        ok: true,
        value: {
          requirementId: replay.result_reference,
          cycleId: request.cycleId,
          locationId: request.locationId,
          inventoryPoolId: request.inventoryPoolId,
          requiredQuantityBase: prior.required_quantity,
          acceptedBase: 0,
          rejectedBase: 0,
          status: prior.status,
          version: prior.version,
        },
        requestId: request.requestId,
      };
  }
  const totals = await deps.db
    .prepare(`SELECT
      COALESCE((SELECT SUM(quantity) FROM committed_demand WHERE delivery_cycle_id=? AND location_id=? AND inventory_pool_id=? AND status='OPEN'), 0) AS demand,
      COALESCE((SELECT on_hand-reserved FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?), 0) AS available,
      COALESCE((SELECT SUM(pr.required_quantity-rr.accepted_quantity) FROM procurement_requirement pr LEFT JOIN receiving_record rr ON rr.procurement_requirement_id=pr.id WHERE pr.delivery_cycle_id=? AND pr.location_id=? AND pr.inventory_pool_id=? AND pr.status IN ('DRAFT','APPROVED','ORDERED','PARTIALLY_RECEIVED')), 0) AS incoming`)
    .bind(
      request.cycleId,
      request.locationId,
      request.inventoryPoolId,
      request.locationId,
      request.inventoryPoolId,
      request.cycleId,
      request.locationId,
      request.inventoryPoolId,
    )
    .first<{ demand: number; available: number; incoming: number }>();
  if (!totals)
    return {
      ok: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message: "Committed-demand aggregation is unavailable",
        requestId: request.requestId,
      },
    };
  const quantity = Math.max(0, totals.demand - totals.available - totals.incoming);
  if (quantity === 0)
    return {
      ok: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message: "No additional procurement requirement is derived from committed demand",
        requestId: request.requestId,
      },
    };
  const result = await createProcurementRequirement(deps.db, {
    requestId: request.requestId,
    headers: request.headers,
    deliveryCycleId: request.cycleId,
    locationId: request.locationId,
    inventoryPoolId: request.inventoryPoolId,
    quantity,
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
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
  const row = await deps.db
    .prepare("SELECT required_quantity, status, version FROM procurement_requirement WHERE id=?")
    .bind(result.value.id)
    .first<{ required_quantity: number; status: string; version: number }>();
  if (!row) return failed("NOT_FOUND", "Procurement requirement not found", request.requestId);
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.PROCUREMENT_DEMAND_AGGREGATED",
    "procurement_requirement",
    result.value.id,
    request.locationId,
    { status: row.status, version: row.version },
  );
  return {
    ok: true,
    value: {
      requirementId: result.value.id,
      cycleId: request.cycleId,
      locationId: request.locationId,
      inventoryPoolId: request.inventoryPoolId,
      requiredQuantityBase: row.required_quantity,
      acceptedBase: 0,
      rejectedBase: 0,
      status: row.status,
      version: row.version,
    },
    requestId: request.requestId,
  };
}

export async function startAdminReceiving(
  deps: OperationsAdministrationDeps,
  request: StartAdminReceivingRequest,
): Promise<RpcResult<ReceivingSessionView>> {
  const permitted = await access(deps, request, "receiving.manage");
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
  const row = await loadReceiving(deps.db, result.value.receivingRecordId);
  if (!row) return failed("NOT_FOUND", "Receiving session not found", request.requestId);
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.RECEIVING_STARTED",
    "receiving_record",
    row.id,
    request.locationId,
    { status: row.status, version: row.version },
  );
  return { ok: true, value: receivingView(row), requestId: request.requestId };
}

export async function recordAdminReceivedLine(
  deps: OperationsAdministrationDeps,
  request: RecordAdminReceivedLineRequest,
): Promise<RpcResult<ReceivingSessionView>> {
  const permitted = await access(deps, request, "receiving.manage");
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
  const row = await loadReceiving(deps.db, request.receivingSessionId);
  if (!row) return failed("NOT_FOUND", "Receiving session not found", request.requestId);
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.RECEIVING_LINE_RECORDED",
    "receiving_record",
    row.id,
    request.locationId,
    {
      acceptedBase: row.accepted_quantity,
      rejectedBase: row.rejected_quantity,
      status: row.status,
      version: row.version,
    },
  );
  return { ok: true, value: receivingView(row), requestId: request.requestId };
}

export async function completeAdminReceiving(
  deps: OperationsAdministrationDeps,
  request: CompleteAdminReceivingRequest,
): Promise<RpcResult<ReceivingSessionView>> {
  const permitted = await access(deps, request, "receiving.manage");
  if (!permitted.ok) return permitted;
  const row = await loadReceiving(deps.db, request.receivingSessionId);
  if (!row || row.location_id !== request.locationId)
    return failed("NOT_FOUND", "Receiving session not found at this location", request.requestId);
  const result = await completeReceiving(deps.db, {
    receivingRecordId: row.id,
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
    requestId: request.requestId,
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
  const completed = await loadReceiving(deps.db, row.id);
  if (!completed) return failed("NOT_FOUND", "Receiving session not found", request.requestId);
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.RECEIVING_COMPLETED",
    "receiving_record",
    completed.id,
    request.locationId,
    { status: completed.status, version: completed.version },
  );
  return { ok: true, value: receivingView(completed), requestId: request.requestId };
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
    { authorize: async (locationId) => locationId === request.locationId },
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
  const row = await deps.db
    .prepare(
      "SELECT f.location_id, f.status, f.version, o.cycle_id FROM fulfillment_record f LEFT JOIN grocery_order o ON o.id=f.order_id WHERE f.order_id=?",
    )
    .bind(request.orderId)
    .first<{ location_id: string; status: string; version: number; cycle_id: string | null }>();
  if (!row || row.location_id !== request.locationId)
    return failed("NOT_FOUND", "Fulfillment task not found at this location", request.requestId);
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.FULFILLMENT_ADVANCED",
    "fulfillment_record",
    request.orderId,
    request.locationId,
    { status: row.status, version: row.version },
  );
  return {
    ok: true,
    value: {
      orderId: request.orderId,
      cycleId: row.cycle_id,
      locationId: row.location_id,
      status: row.status,
      version: row.version,
      allowedActions: [],
    },
    requestId: request.requestId,
  };
}

export async function advanceAdminDelivery(
  deps: OperationsAdministrationDeps,
  request: AdvanceAdminDeliveryRequest,
): Promise<RpcResult<AdminDeliveryOperationView>> {
  const permitted = await access(deps, request, "delivery.manage");
  if (!permitted.ok) return permitted;
  const result = await advanceDelivery(
    deps.db,
    {
      requestId: request.requestId,
      headers: request.headers,
      orderId: request.orderId,
      action: request.action,
      expectedVersion: request.expectedVersion,
      idempotencyKey: request.idempotencyKey,
    },
    { authorize: async (job) => job.locationId === request.locationId },
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
  const row = await deps.db
    .prepare(
      "SELECT d.id, d.status, d.version, d.rider_user_id, d.delivered_at, d.cycle_id, f.location_id FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id WHERE d.order_id=?",
    )
    .bind(request.orderId)
    .first<{
      id: string;
      status: string;
      version: number;
      rider_user_id: string | null;
      delivered_at: number | null;
      cycle_id: string | null;
      location_id: string;
    }>();
  if (!row || row.location_id !== request.locationId)
    return failed("NOT_FOUND", "Delivery job not found at this location", request.requestId);
  await audit(
    deps,
    request,
    permitted.value.authUserId,
    "OPERATIONS.DELIVERY_ADVANCED",
    "delivery_job",
    row.id,
    request.locationId,
    { status: row.status, version: row.version },
  );
  return {
    ok: true,
    value: {
      jobId: row.id,
      orderId: request.orderId,
      cycleId: row.cycle_id,
      locationId: row.location_id,
      status: row.status,
      riderAssigned: row.rider_user_id !== null,
      deliveredAtIso: row.delivered_at === null ? null : new Date(row.delivered_at).toISOString(),
      version: row.version,
      allowedActions: [],
    },
    requestId: request.requestId,
  };
}

export async function resolveAdminOperationalException(
  deps: OperationsAdministrationDeps,
  request: ResolveAdminOperationalExceptionRequest,
): Promise<RpcResult<FulfillmentQueueView | AdminDeliveryOperationView>> {
  if (request.reason.trim() === "")
    return failed("VALIDATION_FAILED", "A resolution reason is required", request.requestId);
  if (request.kind === "FULFILLMENT_SHORTAGE" && request.action === "RETRY_FULFILLMENT")
    return advanceAdminFulfillment(deps, { ...request, action: "START" });
  if (request.kind === "DELIVERY_FAILED" && request.action === "RETRY_DELIVERY")
    return advanceAdminDelivery(deps, { ...request, action: "DISPATCH" });
  return failed(
    "VALIDATION_FAILED",
    "Exception action is not supported for this source",
    request.requestId,
  );
}
