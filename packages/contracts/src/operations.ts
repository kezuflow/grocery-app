import type { RpcResult } from "./common";
import type {
  AuthenticatedRequest,
  DeliveryCommandRequest,
  FulfillmentCommandRequest,
  InventoryAdjustmentRequest,
  InventoryAdjustmentResult,
  ProcurementCommandRequest,
  ReceivingCommandRequest,
  ReceivingCommandResult,
} from "./index";
import type { OperationsCommandState } from "./states";

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
  advanceDelivery(request: DeliveryCommandRequest): Promise<RpcResult<OperationsCommandResult>>;
};

/**
 * Purpose-built operational read models. Sections are decision DTOs scoped by
 * capability and location in Core; a section the actor is not authorized for
 * is reported in `sectionsDenied` instead of leaking rows. `allowedActions`
 * derive from canonical transition policy — the UI never invents
 * authorization.
 */
export type OperationsReadSection = "fulfillment" | "delivery" | "procurement";

export type AdminOperationsBoardRequest = AuthenticatedRequest & {
  /** Defaults to the market's active default fulfillment location. */
  locationId?: string | null;
};

export type FulfillmentQueueItem = {
  orderId: string;
  status: string;
  locationId: string;
  version: number;
  allowedActions: ReadonlyArray<"START" | "PACK" | "SHORTAGE">;
};

export type DeliveryDispatchItem = {
  jobId: string;
  orderId: string;
  status: string;
  riderAuthUserId: string | null;
  deliveredAtIso: string | null;
  version: number;
  allowedActions: ReadonlyArray<"DISPATCH" | "DELIVER" | "FAIL">;
};

export type ProcurementQueueItem = {
  requirementId: string;
  locationId: string;
  inventoryPoolId: string;
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
  ageMinutes: number;
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

export type AdminOperationsBoardValue = {
  locationId: string;
  fulfillment: ReadonlyArray<FulfillmentQueueItem>;
  delivery: ReadonlyArray<DeliveryDispatchItem>;
  procurement: ReadonlyArray<ProcurementQueueItem>;
  exceptions: ReadonlyArray<OperationalExceptionItem>;
  sectionsDenied: ReadonlyArray<OperationsReadSection>;
};

export type AssignRiderRequest = AuthenticatedRequest & {
  orderId: string;
  riderAuthUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AssignRiderValue = { orderId: string; riderAuthUserId: string; status: string };

export type RiderJobsValue = {
  jobs: ReadonlyArray<{
    jobId: string;
    orderId: string;
    status: string;
    addressSnapshotJson: string;
    version: number;
    allowedActions: ReadonlyArray<"DISPATCH" | "DELIVER" | "FAIL">;
  }>;
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
  adminOperationsBoard(
    request: AdminOperationsBoardRequest,
  ): Promise<RpcResult<AdminOperationsBoardValue>>;
  assignRider(request: AssignRiderRequest): Promise<RpcResult<AssignRiderValue>>;
  riderJobs(request: AuthenticatedRequest): Promise<RpcResult<RiderJobsValue>>;
  adminScheduledJobRuns(
    request: AdminScheduledJobRunsRequest,
  ): Promise<RpcResult<AdminScheduledJobRunsValue>>;
};
