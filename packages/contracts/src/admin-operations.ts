import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./index";
import type { OperationalExceptionItem } from "./operations";

export const adminOperationsReadCapabilities = [
  "procurement.read",
  "receiving.manage",
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
  allowedActions: ReadonlyArray<"START" | "PACK" | "SHORTAGE">;
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
  allowedActions: ReadonlyArray<"DISPATCH" | "DELIVER" | "FAIL">;
};

export type OperationalExceptionPage = {
  items: ReadonlyArray<OperationalExceptionItem>;
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

/** Scoped operational administration read and configuration surface. */
export type AdminOperationsService = {
  getFulfillmentMode(
    request: AdminOperationsLocationRequest,
  ): Promise<RpcResult<FulfillmentModeConfigurationView>>;
  activateFulfillmentMode(
    request: ActivateFulfillmentModeRequest,
  ): Promise<RpcResult<FulfillmentModeConfigurationView>>;
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
