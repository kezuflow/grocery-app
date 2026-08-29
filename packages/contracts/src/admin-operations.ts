import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./index";
import type { OperationalExceptionItem } from "./operations";
import type { DeliveryAction, FulfillmentAction } from "./states";
export {
  deliveryActions,
  deliveryJobStates as deliveryStatuses,
  fulfillmentActions,
  fulfillmentStates as fulfillmentStatuses,
  procurementStates,
} from "./states";

/** Converged queue item; source context remains authoritative for mutations. */
export type AdminOperationalExceptionView = OperationalExceptionItem;

export const adminOperationsReadCapabilities = [
  "procurement.read",
  "procurement.manage",
  "fulfillment.read",
  "delivery.read",
  "fulfillment.manage",
] as const;

export type FulfillmentModeConfigurationView = {
  locationId: string;
  activeMode: "INSTANT" | "SCHEDULED";
  /** `WEEKLY` is a Scheduled configuration value, never a fulfillment mode. */
  cadence: "WEEKLY" | null;
  promiseMinutes: number | null;
  maxConcurrentInstantOrders: number | null;
  version: number;
};

export type ProcurementRequirementView = {
  requirementId: string;
  cycleId: string;
  locationId: string;
  inventoryPoolId: string;
  requiredQuantityBase: number;
  acceptedBase: number;
  rejectedBase: number;
  status: string;
  version: number;
};

export type ProcurementRequirementPage = {
  items: ReadonlyArray<ProcurementRequirementView>;
  nextCursor: string | null;
};

export type ReceivingSessionView = {
  receivingSessionId: string;
  requirementId: string;
  cycleId: string;
  locationId: string;
  expectedBase: number;
  acceptedBase: number;
  rejectedBase: number;
  status: string;
  version: number;
};

export type ReceivingSessionPage = {
  items: ReadonlyArray<ReceivingSessionView>;
  nextCursor: string | null;
};

export type FulfillmentQueueView = {
  orderId: string;
  cycleId: string | null;
  locationId: string;
  status: string;
  version: number;
  allowedActions: ReadonlyArray<FulfillmentAction>;
};

export type FulfillmentQueuePage = {
  items: ReadonlyArray<FulfillmentQueueView>;
  nextCursor: string | null;
};

export type DeliveryOperationsSummary = {
  locationId: string;
  cycleId: string | null;
  status: "OPEN" | "EMPTY";
  totalOpenJobs: number;
  assignedJobs: number;
  items: ReadonlyArray<AdminDeliveryOperationView>;
  nextCursor: string | null;
};

/** Delivery queue fields safe for Admin decisions; customer address snapshots stay internal. */
export type AdminDeliveryOperationView = {
  jobId: string;
  orderId: string;
  cycleId: string | null;
  locationId: string;
  status: string;
  riderAssigned: boolean;
  deliveredAtIso: string | null;
  version: number;
  allowedActions: ReadonlyArray<DeliveryAction>;
};

export type OperationalExceptionPage = {
  items: ReadonlyArray<AdminOperationalExceptionView>;
  nextCursor: string | null;
};

export type AdminOperationsLocationRequest = AuthenticatedRequest & {
  locationId: string;
};

export type AdminProcurementRequirementsRequest = AdminOperationsLocationRequest & {
  cycleId?: string;
  cursor?: string;
  limit?: number;
};

export type AdminReceivingSessionsRequest = AdminOperationsLocationRequest & {
  cycleId?: string;
  cursor?: string;
  limit?: number;
};

export type AdminFulfillmentQueueRequest = AdminOperationsLocationRequest & {
  cycleId?: string;
  cursor?: string;
  limit?: number;
};

export type AdminDeliveryOperationsRequest = AdminOperationsLocationRequest & {
  cycleId?: string;
  cursor?: string;
  limit?: number;
};

export type AdminOperationalExceptionsRequest = AdminOperationsLocationRequest & {
  cursor?: string;
  limit?: number;
};

export type ActivateFulfillmentModeRequest = AdminOperationsLocationRequest & {
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  cadence?: "WEEKLY" | null;
  promiseMinutes?: number | null;
  maxConcurrentInstantOrders?: number | null;
  expectedVersion: number | null;
  idempotencyKey: string;
};

export type AggregateAdminProcurementDemandRequest = AdminOperationsLocationRequest & {
  cycleId: string;
  inventoryPoolId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

export type StartAdminReceivingRequest = AdminOperationsLocationRequest & {
  requirementId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

export type RecordAdminReceivedLineRequest = AdminOperationsLocationRequest & {
  receivingSessionId: string;
  acceptedBase: number;
  rejectedBase: number;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

export type CompleteAdminReceivingRequest = AdminOperationsLocationRequest & {
  receivingSessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

export type AdvanceAdminFulfillmentRequest = AdminOperationsLocationRequest & {
  orderId: string;
  action: FulfillmentAction;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

export type AdvanceAdminDeliveryRequest = AdminOperationsLocationRequest & {
  orderId: string;
  action: DeliveryAction;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

export type ResolveAdminOperationalExceptionRequest = AdminOperationsLocationRequest & {
  kind: "FULFILLMENT_SHORTAGE" | "DELIVERY_FAILED";
  action: "RETRY_FULFILLMENT" | "RETRY_DELIVERY";
  orderId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};

/** Scoped operational administration read and configuration surface. */
export type AdminOperationsService = {
  getFulfillmentMode(
    request: AdminOperationsLocationRequest,
  ): Promise<RpcResult<FulfillmentModeConfigurationView>>;
  activateFulfillmentMode(
    request: ActivateFulfillmentModeRequest,
  ): Promise<RpcResult<FulfillmentModeConfigurationView>>;
  aggregateAdminProcurementDemand(
    request: AggregateAdminProcurementDemandRequest,
  ): Promise<RpcResult<ProcurementRequirementView>>;
  startAdminReceiving(
    request: StartAdminReceivingRequest,
  ): Promise<RpcResult<ReceivingSessionView>>;
  recordAdminReceivedLine(
    request: RecordAdminReceivedLineRequest,
  ): Promise<RpcResult<ReceivingSessionView>>;
  completeAdminReceiving(
    request: CompleteAdminReceivingRequest,
  ): Promise<RpcResult<ReceivingSessionView>>;
  advanceAdminFulfillment(
    request: AdvanceAdminFulfillmentRequest,
  ): Promise<RpcResult<FulfillmentQueueView>>;
  advanceAdminDelivery(
    request: AdvanceAdminDeliveryRequest,
  ): Promise<RpcResult<AdminDeliveryOperationView>>;
  resolveAdminOperationalException(
    request: ResolveAdminOperationalExceptionRequest,
  ): Promise<RpcResult<FulfillmentQueueView | AdminDeliveryOperationView>>;
  listProcurementRequirements(
    request: AdminProcurementRequirementsRequest,
  ): Promise<RpcResult<ProcurementRequirementPage>>;
  listReceivingSessions(
    request: AdminReceivingSessionsRequest,
  ): Promise<RpcResult<ReceivingSessionPage>>;
  listFulfillmentQueue(
    request: AdminFulfillmentQueueRequest,
  ): Promise<RpcResult<FulfillmentQueuePage>>;
  listDeliveryOperations(
    request: AdminDeliveryOperationsRequest,
  ): Promise<RpcResult<DeliveryOperationsSummary>>;
  listOperationalExceptions(
    request: AdminOperationalExceptionsRequest,
  ): Promise<RpcResult<OperationalExceptionPage>>;
};
