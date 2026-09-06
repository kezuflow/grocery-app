import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./auth";
import type { FulfillmentAction, OperationsCommandState, ReceivingRecordState } from "./states";

export type AdminCommandResult = { id: string; status: OperationsCommandState };

export type InventoryAdjustmentRequest = AuthenticatedRequest & {
  locationId: string;
  inventoryPoolId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type InventoryAdjustmentResult = {
  locationId: string;
  inventoryPoolId: string;
  onHandBase: number;
  reservedBase: number;
  version: number;
  ledgerEntryId: string;
};

export type ProcurementCommandRequest = AuthenticatedRequest & {
  deliveryCycleId: string;
  locationId: string;
  inventoryPoolId: string;
  skuId: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type ReceivingCommandRequest = AuthenticatedRequest & {
  requirementId: string;
  acceptedQuantity: number;
  rejectedQuantity: number;
  reason?: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type ReceivingCommandResult = {
  receivingRecordId: string;
  status: ReceivingRecordState;
  acceptedBase: number;
  rejectedBase: number;
  remainingBase: number;
  version: number;
};

export type FulfillmentCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: FulfillmentAction;
  idempotencyKey: string;
  expectedVersion: number;
};

export type OperationsCommandResult = { id: string; status: OperationsCommandState };

/**
 * Canonical operations target command groups. Every group is a typed domain
 * command with a stable idempotency key and required aggregate version;
 * free-form string actions have no place here.
 */
export type OperationsService = {
  adjustInventory(
    request: InventoryAdjustmentRequest,
  ): Promise<RpcResult<InventoryAdjustmentResult>>;
  createProcurementRequirement(
    request: ProcurementCommandRequest,
  ): Promise<RpcResult<OperationsCommandResult>>;
  receiveProcurement(request: ReceivingCommandRequest): Promise<RpcResult<ReceivingCommandResult>>;
  advanceFulfillment(
    request: FulfillmentCommandRequest,
  ): Promise<RpcResult<OperationsCommandResult>>;
};

/**
 * Purpose-built operational read models. Sections are decision DTOs scoped by
 * capability and location in Core; a section the actor is not authorized for
 * is reported in `sectionsDenied` instead of leaking rows. `allowedActions`
 * derive from canonical transition policy — the UI never invents
 * authorization.
 */
export type FulfillmentQueueItem = {
  orderId: string;
  status: string;
  locationId: string;
  version: number;
  allowedActions: ReadonlyArray<FulfillmentAction>;
};

export type ProcurementQueueItem = {
  requirementId: string;
  locationId: string;
  inventoryPoolId: string;
  skuId: string | null;
  requiredQuantityBase: number;
  acceptedBase: number;
  rejectedBase: number;
  requirementStatus: string;
  receivingStatus: string | null;
  receivingVersion: number | null;
};

export type OperationalExceptionItem = {
  kind:
    | "PROCUREMENT_SHORTAGE"
    | "FULFILLMENT_SHORTAGE"
    | "DELIVERY_FAILED"
    | "RECEIVING_DISCREPANCY";
  /** Owning bounded context; the convergence queue never owns this state. */
  source: "PROCUREMENT" | "RECEIVING" | "FULFILLMENT" | "DELIVERY";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Age in whole minutes, computed from the source record's creation/update instant. */
  ageMinutes: number | null;
  /** Current source-assigned operator, when the source provides one. */
  ownerId: string | null;
  referenceId: string;
  orderId: string | null;
  locationId: string | null;
  reason: string;
  permittedActions: ReadonlyArray<
    | "ALTERNATE_SOURCE"
    | "ACKNOWLEDGE"
    | "RETRY_FULFILLMENT"
    | "RETRY_DELIVERY"
    | "RESCHEDULE"
    | "REFUND"
    | "ESCALATE"
  >;
  detail: string;
};

/**
 * Observation record of one finished scheduled-job attempt. Purpose-built
 * operational telemetry: no raw scheduler internals are exposed.
 */
export type ScheduledJobRunView = {
  id: string;
  jobName: string;
  cronExpression: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  affectedCount: number | null;
  errorCode: string | null;
  detail: string | null;
  startedAt: number;
  finishedAt: number;
};

export type AdminScheduledJobRunsRequest = AuthenticatedRequest & {
  /** Defaults to the platform bound; clamped by Core. */
  limit?: number;
};

export type AdminScheduledJobRunsValue = { runs: ReadonlyArray<ScheduledJobRunView> };

export type OperationsReadService = {
  adminScheduledJobRuns(
    request: AdminScheduledJobRunsRequest,
  ): Promise<RpcResult<AdminScheduledJobRunsValue>>;
};
