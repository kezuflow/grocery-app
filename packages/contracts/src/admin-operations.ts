import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./auth";
import type { OperationalExceptionItem } from "./operations";
import type { FulfillmentAction } from "./states";
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

export type CommerceReadinessBlockerView = {
  code: string;
  message: string;
};

export type GlobalCommerceConfigurationView = {
  sellingState: "OPEN" | "PAUSED";
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  /** `WEEKLY` is a Scheduled configuration value, never a fulfillment mode. */
  cadence: "WEEKLY" | null;
  version: number;
  readinessBlockers: readonly CommerceReadinessBlockerView[];
};

export type ProcurementRequirementView = {
  requirementId: string;
  cycleId: string;
  locationId: string;
  inventoryPoolId: string;
  skuId: string | null;
  committedQuantitySellable: number | null;
  shippingWeightGrams: number | null;
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
  productId?: string;
  variantName?: string;
  stockTracking?: "SHARED" | "COUNTED_SIZES";
  productName?: string;
  cycleName?: string;
  baseUnit?: string;
  allowedActions?: ReadonlyArray<"START" | "RECORD" | "REPLACE" | "COMPLETE">;
  legacyAcceptedBase?: number;
  resolvedByCancellation?: boolean;
  shortageBase?: number;
  replacementBase?: number;
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
  surplus?: readonly import("./scheduled-surplus").ScheduledSurplusView[];
  countedReceipts?: readonly import("./scheduled-counted-receipts").ScheduledCountedReceiptView[];
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
  bookedJobs: number;
  items: ReadonlyArray<AdminDeliveryOperationView>;
  nextCursor: string | null;
};

/** Delivery queue fields safe for Admin decisions; customer address snapshots stay internal. */
export type AdminDeliveryOperationView = {
  jobId: string;
  orderId: string;
  cycleId: string | null;
  locationId: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  status: string;
  manualActions: ReadonlyArray<ManualDeliveryAction>;
  canRevisePromise: boolean;
  canInspectReturnedGoods: boolean;
  courierPickup: {
    allowedKinds: ReadonlyArray<"IMMEDIATE" | "SCHEDULED">;
    unavailableReason: string | null;
  };
  manualDelivery: {
    dispatchId: string;
    personName: string;
    phoneE164: string;
    reason: string;
    status: string;
    handedOverAt: number | null;
    returnInspectedAt: number | null;
    actualCostMinor: number | null;
    currency: string | null;
    version: number;
  } | null;
  externalDispatch: {
    providerStatus: string | null;
    dispatchId: string;
    provider: "lalamove" | "grab-express";
    status: string;
    trackingUrl: string | null;
    providerDeliveryId: string | null;
    version: number;
  } | null;
  deliveredAtIso: string | null;
  version: number;
};

export type LocationDeliveryProfileView = {
  locationId: string;
  locationName: string;
  coordinate: { latitude: number; longitude: number };
  profile: {
    senderName: string;
    phoneE164: string;
    email: string | null;
    formattedAddress: string;
    addressLine1: string;
    addressLine2: string | null;
    barangay: string | null;
    city: string;
    region: string | null;
    postalCode: string | null;
    countryCode: string;
    pickupInstructions: string | null;
    version: number;
  } | null;
};

export type UpsertLocationDeliveryProfileRequest = AdminOperationsLocationRequest & {
  senderName: string;
  phoneE164: string;
  email?: string | null;
  formattedAddress: string;
  addressLine1: string;
  addressLine2?: string | null;
  barangay?: string | null;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  countryCode: string;
  pickupInstructions?: string | null;
  /** Zero creates the first profile; positive values update it with CAS. */
  expectedVersion: number;
  idempotencyKey: string;
};

export type RequestExternalDeliveryRequest = AdminOperationsLocationRequest & {
  jobId: string;
  expectedVersion: number;
  providerCode: "lalamove";
  pickup: { kind: "IMMEDIATE" } | { kind: "SCHEDULED"; pickupAt: string };
  idempotencyKey: string;
};

export type ReviseDeliveryPromiseRequest = AdminOperationsLocationRequest & {
  jobId: string;
  expectedVersion: number;
  promisedAt: string;
  agreementNote: string;
  returnInspection?: { allGoodsSuitableAndPacked: true; note: string };
  idempotencyKey: string;
};
export type ReviseDeliveryPromiseResult = {
  revisionId: string;
  jobId: string;
  promisedAt: string;
  version: number;
};

export type ManualDeliveryAction = "ASSIGN" | "HAND_OVER" | "COMPLETE" | "FAIL";
export type ManualDeliveryRequest = AdminOperationsLocationRequest & {
  jobId: string;
  expectedVersion: number;
  idempotencyKey: string;
} & (
    | { action: "ASSIGN"; reason: string; personName: string; phoneE164: string }
    | { action: "HAND_OVER"; dispatchId: string }
    | { action: "COMPLETE"; dispatchId: string; actualCostMinor: number | null }
    | { action: "FAIL"; dispatchId: string; reason: string; actualCostMinor: number | null }
  );

export type ManualDeliveryResult = {
  dispatchId: string;
  jobId: string;
  status: "ACTIVE" | "COMPLETED" | "FAILED";
  version: number;
};

export type ExternalDeliveryMutationRequest = AdminOperationsLocationRequest & {
  dispatchId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type RefreshExternalDeliveryRequest = ExternalDeliveryMutationRequest & {
  /** Candidate identity for an uncertain booking; Core verifies provider merchant metadata. */
  providerDeliveryId?: string;
};

export type ExternalDeliveryDispatchView = {
  dispatchId: string;
  deliveryJobId: string;
  provider: "lalamove" | "grab-express";
  providerDeliveryId: string | null;
  status: string;
  providerStatus: string | null;
  trackingUrl: string | null;
  pickupPin: string | null;
  quoteAmountMinor: number | null;
  quoteCurrency: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  version: number;
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

export type PauseSellingRequest = AuthenticatedRequest & {
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};

export type ActivateGlobalFulfillmentModeRequest = AuthenticatedRequest & {
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  cadence?: "WEEKLY" | null;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};

export type OpenSellingRequest = AuthenticatedRequest & {
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};

export type ConfirmAdminProcurementPurchaseRequest = AggregateAdminProcurementDemandRequest & {
  reason: string;
  expectedQuantityBase: number;
  expectedQuantitySellable: number;
};

export type AggregateAdminProcurementDemandRequest = AdminOperationsLocationRequest & {
  cycleId: string;
  inventoryPoolId: string;
  skuId: string;
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
  receiptKind?: "DELIVERY" | "REPLACEMENT";
  shortageBase?: number;
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

export type ResolveAdminOperationalExceptionRequest = AdminOperationsLocationRequest & {
  kind: "FULFILLMENT_SHORTAGE";
  action: "RETRY_FULFILLMENT";
  orderId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};

/** Scoped operational administration read and configuration surface. */
export type AdminOperationsService = {
  getGlobalCommerceConfiguration(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<GlobalCommerceConfigurationView>>;
  pauseSelling(request: PauseSellingRequest): Promise<RpcResult<GlobalCommerceConfigurationView>>;
  activateGlobalMode(
    request: ActivateGlobalFulfillmentModeRequest,
  ): Promise<RpcResult<GlobalCommerceConfigurationView>>;
  openSelling(request: OpenSellingRequest): Promise<RpcResult<GlobalCommerceConfigurationView>>;
  confirmAdminProcurementPurchase(
    request: ConfirmAdminProcurementPurchaseRequest,
  ): Promise<RpcResult<ProcurementRequirementView>>;
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
  resolveAdminOperationalException(
    request: ResolveAdminOperationalExceptionRequest,
  ): Promise<RpcResult<FulfillmentQueueView>>;
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
  getLocationDeliveryProfile(
    request: AdminOperationsLocationRequest,
  ): Promise<RpcResult<LocationDeliveryProfileView>>;
  upsertLocationDeliveryProfile(
    request: UpsertLocationDeliveryProfileRequest,
  ): Promise<RpcResult<LocationDeliveryProfileView>>;
  requestExternalDelivery(
    request: RequestExternalDeliveryRequest,
  ): Promise<RpcResult<ExternalDeliveryDispatchView>>;
  reviseDeliveryPromise(
    request: ReviseDeliveryPromiseRequest,
  ): Promise<RpcResult<ReviseDeliveryPromiseResult>>;
  manageManualDelivery(request: ManualDeliveryRequest): Promise<RpcResult<ManualDeliveryResult>>;
  refreshExternalDelivery(
    request: RefreshExternalDeliveryRequest,
  ): Promise<RpcResult<ExternalDeliveryDispatchView>>;
  cancelExternalDelivery(
    request: ExternalDeliveryMutationRequest,
  ): Promise<RpcResult<ExternalDeliveryDispatchView>>;
  listOperationalExceptions(
    request: AdminOperationalExceptionsRequest,
  ): Promise<RpcResult<OperationalExceptionPage>>;
};
