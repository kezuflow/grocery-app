import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export const orderIssueCategories = [
  "MISSING_ITEM",
  "WRONG_ITEM",
  "DAMAGED",
  "QUALITY",
  "QUANTITY",
  "DELIVERY",
  "OTHER",
] as const;
export type OrderIssueCategory = (typeof orderIssueCategories)[number];

export const orderIssueStatuses = [
  "SUBMITTED",
  "CLAIMED",
  "INVESTIGATING",
  "RESOLVED",
  "ESCALATED",
] as const;
export type OrderIssueStatus = (typeof orderIssueStatuses)[number];

export const orderIssueActions = ["CLAIM", "BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"] as const;
export type OrderIssueAction = (typeof orderIssueActions)[number];

export const reconciliationCaseCategories = [
  "UNMAPPED_PROVIDER_REFERENCE",
  "AMBIGUOUS_OUTCOME",
  "PROVIDER_TIMEOUT",
  "REACTION_FAILURE",
  "REFUND_UNRESOLVED",
] as const;
export type ReconciliationCaseCategory = (typeof reconciliationCaseCategories)[number];

export type AdminOrderSummary = {
  orderId: string;
  orderNumber: string | null;
  /** Recipient from the immutable Order address snapshot, not the auth profile. */
  customerName: string | null;
  customerEmail: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  status: string;
  totalMinor: number;
  currency: string;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
  committedAt: string | null;
  version: number;
};

export type AdminOrderPage = {
  items: ReadonlyArray<AdminOrderSummary>;
  nextCursor: string | null;
};

export type AdminOrderItemView = {
  productName: string;
  variantName: string;
  unit: string;
  quantity: number;
  baseQuantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type AdminOrderFinancialView = {
  subtotalMinor: number | null;
  discountMinor: number | null;
  deliveryFeeMinor: number | null;
  serviceFeeMinor: number | null;
  taxMinor: number | null;
  totalMinor: number;
  currency: string;
  source: "CHECKOUT_QUOTE" | "ORDER_TOTAL_ONLY";
};

export type AdminOrderCustomerView = {
  name: string | null;
  email: string;
  phone: string | null;
  addressLines: ReadonlyArray<string>;
};

export type AdminOrderPaymentView = {
  paymentIntentId: string;
  purpose: string;
  status: string;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  createdAt: string;
};

export type AdminOrderAmendmentView = {
  amendmentId: string;
  status: string;
  totalMinor: number;
  currency: string;
  paymentIntentId: string | null;
  createdAt: string;
  updatedAt: string;
  lines: ReadonlyArray<AdminOrderItemView>;
};

export type AdminOrderFulfillmentView = {
  locationId: string;
  cycleId: string | null;
  zoneId: string | null;
  fulfillmentMode: string;
  cutoffAt: string | null;
  deliveryDate: string | null;
  promisedAt: string | null;
  sourcingModes: ReadonlyArray<string>;
  status: string | null;
  version: number | null;
  updatedAt: string | null;
};

export type AdminOrderDeliveryView = {
  deliveryJobId: string;
  status: string;
  riderUserId: string | null;
  version: number;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrderExceptionView = {
  exceptionId: string;
  source: "FINANCE" | "ORDER_ISSUE";
  kind: string;
  status: string;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminTimelineEntry = {
  eventId: string;
  kind: "ORDER" | "PAYMENT" | "FULFILLMENT" | "DELIVERY" | "AMENDMENT" | "AUDIT";
  label: string;
  status: string | null;
  occurredAt: string;
  referenceId: string | null;
};

export type AdminOrderDetail = AdminOrderSummary & {
  allowedActions: ReadonlyArray<"CANCEL">;
  customer: AdminOrderCustomerView;
  financial: AdminOrderFinancialView;
  items: ReadonlyArray<AdminOrderItemView>;
  payments: ReadonlyArray<AdminOrderPaymentView>;
  amendments: ReadonlyArray<AdminOrderAmendmentView>;
  fulfillment: AdminOrderFulfillmentView | null;
  delivery: AdminOrderDeliveryView | null;
  exceptions: ReadonlyArray<AdminOrderExceptionView>;
  timeline: ReadonlyArray<AdminTimelineEntry>;
  recentAudit: ReadonlyArray<{
    auditEventId: string;
    occurredAt: string;
    action: string;
    reason: string | null;
  }>;
};

export type AdminOrderListRequest = AuthenticatedRequest & {
  status?: string;
  cursor?: string;
  limit?: number;
};

export type AdminOrderDetailRequest = AuthenticatedRequest & {
  orderId: string;
};

export type AdminOrderCancelRequest = AuthenticatedRequest & {
  orderId: string;
  /** Canonical cancellation reason. reasonCode is retained for older clients. */
  reason?: string;
  reasonCode?: string;
  /** Operational resolution captured with the cancellation decision. */
  resolution?: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminPaymentSummary = {
  paymentIntentId: string;
  purpose: string;
  customerEmail: string;
  amountMinor: number;
  currency: string;
  status: string;
  refundedMinor: number;
  createdAt: string;
};

export type AdminPaymentPage = {
  items: ReadonlyArray<AdminPaymentSummary>;
  nextCursor: string | null;
};

export type AdminPaymentListRequest = AuthenticatedRequest & {
  status?: string;
  cursor?: string;
  limit?: number;
};

export type AdminPaymentDetailRequest = AuthenticatedRequest & {
  paymentIntentId: string;
};

export type AdminPaymentAttemptView = {
  attemptId: string;
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminPaymentEventView = {
  eventId: string;
  provider: string;
  eventType: string;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
};

export type AdminPaymentReactionView = {
  reactionId: string;
  reactionType: string;
  subjectType: string;
  subjectId: string;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
  availableAt: string;
  processedAt: string | null;
};

export type AdminPaymentReconciliationView = AdminReconciliationCaseView;

export type AdminPaymentDetail = AdminPaymentSummary & {
  subjectType: string;
  subjectId: string;
  remainingRefundableMinor: number;
  version: number;
  updatedAt: string;
  allowedActions: ReadonlyArray<"REQUEST_REFUND">;
  attempts: ReadonlyArray<AdminPaymentAttemptView>;
  refunds: ReadonlyArray<AdminRefundView>;
  events: ReadonlyArray<AdminPaymentEventView>;
  reactions: ReadonlyArray<AdminPaymentReactionView>;
  reconciliationCases: ReadonlyArray<AdminPaymentReconciliationView>;
  recentAudit: ReadonlyArray<{
    auditEventId: string;
    occurredAt: string;
    action: string;
    reason: string | null;
  }>;
};

export type AdminPaymentOverview = {
  intentCounts: {
    total: number;
    actionRequired: number;
    processing: number;
    succeeded: number;
    failed: number;
  };
  openReconciliationCount: number;
  pendingRefundCount: number;
  totalsByCurrency: ReadonlyArray<{
    currency: string;
    succeededMinor: number;
    refundedMinor: number;
  }>;
  recentTransactions: ReadonlyArray<AdminPaymentSummary>;
};

export type AdminRefundRequest = AuthenticatedRequest & {
  paymentIntentId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
};

export type AdminRefundView = {
  refundId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type AdminReconciliationCaseView = {
  caseId: string;
  paymentIntentId: string | null;
  category: ReconciliationCaseCategory;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminReconciliationPage = {
  items: ReadonlyArray<AdminReconciliationCaseView>;
  nextCursor: string | null;
};

export type AdminReconciliationListRequest = AuthenticatedRequest & {
  status?: "OPEN" | "RESOLVED";
  cursor?: string;
  limit?: number;
};

export type AdminReconciliationResolveRequest = AuthenticatedRequest & {
  caseId: string;
  reason: string;
  idempotencyKey: string;
};

export type AdminMembershipSummary = {
  subscriptionId: string;
  customerEmail: string;
  state: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndsAt: string | null;
  version: number;
};

export type AdminMembershipPage = {
  items: ReadonlyArray<AdminMembershipSummary>;
  nextCursor: string | null;
};

export type AdminMembershipListRequest = AuthenticatedRequest & {
  cursor?: string;
  limit?: number;
};

export type AdminMembershipDetailRequest = AuthenticatedRequest & {
  subscriptionId: string;
};

export type AdminMembershipLifecycleRequest = AuthenticatedRequest & {
  subscriptionId: string;
  timing?: "IMMEDIATE" | "PERIOD_END";
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminOrderIssueView = {
  issueId: string;
  orderId: string;
  category: OrderIssueCategory;
  status: OrderIssueStatus;
  details: string | null;
  assignedStaffId: string | null;
  resolution: string | null;
  allowedActions: ReadonlyArray<OrderIssueAction>;
  version: number;
  createdAt: string;
};

export type AdminOrderIssueContext = {
  orderNumber: string | null;
  /** Recipient from the immutable Order address snapshot, not the auth profile. */
  customerName: string | null;
  customerEmail: string;
  assignedStaffName: string | null;
};

export type AdminOrderIssueDetail = AdminOrderIssueView & AdminOrderIssueContext;

export type AdminOrderIssueSummary = AdminOrderIssueView & AdminOrderIssueContext;

export type AdminOrderIssuePage = {
  items: ReadonlyArray<AdminOrderIssueSummary>;
  nextCursor: string | null;
};

export type AdminOrderIssueListRequest = AuthenticatedRequest & {
  status?: OrderIssueStatus;
  cursor?: string;
  limit?: number;
};

export type AdminOrderIssueActionRequest = AuthenticatedRequest & {
  issueId: string;
  action: OrderIssueAction;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminOrderIssueDetailRequest = AuthenticatedRequest & { issueId: string };

/**
 * Finance and lifecycle administration. Every method derives the caller from
 * the forwarded session, requires the named capability plus a global scope in
 * Core, and wraps canonical domain commands — admin never patches status.
 */
export type AdminOrdersService = {
  listAdminOrders(request: AdminOrderListRequest): Promise<RpcResult<AdminOrderPage>>;
  getAdminOrder(request: AdminOrderDetailRequest): Promise<RpcResult<AdminOrderDetail>>;
  cancelAdminOrder(request: AdminOrderCancelRequest): Promise<RpcResult<AdminOrderDetail>>;
};

export type AdminPaymentsService = {
  getAdminPaymentOverview(request: AuthenticatedRequest): Promise<RpcResult<AdminPaymentOverview>>;
  listAdminPayments(request: AdminPaymentListRequest): Promise<RpcResult<AdminPaymentPage>>;
  getAdminPayment(request: AdminPaymentDetailRequest): Promise<RpcResult<AdminPaymentDetail>>;
  requestAdminRefund(request: AdminRefundRequest): Promise<RpcResult<AdminRefundView>>;
  listAdminReconciliationCases(
    request: AdminReconciliationListRequest,
  ): Promise<RpcResult<AdminReconciliationPage>>;
  resolveAdminReconciliationCase(
    request: AdminReconciliationResolveRequest,
  ): Promise<RpcResult<AdminReconciliationCaseView>>;
};

export type AdminMembershipsService = {
  listAdminMemberships(
    request: AdminMembershipListRequest,
  ): Promise<RpcResult<AdminMembershipPage>>;
  getAdminMembership(
    request: AdminMembershipDetailRequest,
  ): Promise<RpcResult<AdminMembershipSummary>>;
  pauseAdminMembership(
    request: AdminMembershipLifecycleRequest,
  ): Promise<RpcResult<AdminMembershipSummary>>;
  resumeAdminMembership(
    request: AdminMembershipLifecycleRequest,
  ): Promise<RpcResult<AdminMembershipSummary>>;
  cancelAdminMembership(
    request: AdminMembershipLifecycleRequest,
  ): Promise<RpcResult<AdminMembershipSummary>>;
};

export type AdminOrderIssuesService = {
  listAdminOrderIssues(
    request: AdminOrderIssueListRequest,
  ): Promise<RpcResult<AdminOrderIssuePage>>;
  getAdminOrderIssue(
    request: AdminOrderIssueDetailRequest,
  ): Promise<RpcResult<AdminOrderIssueDetail>>;
  applyAdminOrderIssueAction(
    request: AdminOrderIssueActionRequest,
  ): Promise<RpcResult<AdminOrderIssueView>>;
};
