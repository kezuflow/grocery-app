import type { AuthenticatedRequest, RpcResult } from "./index";

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

export const orderIssueActions = [
  "CLAIM",
  "BEGIN_INVESTIGATION",
  "RESOLVE",
  "ESCALATE",
  "REOPEN",
] as const;
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
  customerEmail: string;
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
  skuName: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type AdminOrderDetail = AdminOrderSummary & {
  items: ReadonlyArray<AdminOrderItemView>;
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
  details: string | null;
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
  version: number;
  createdAt: string;
};

export type AdminOrderIssueDetail = AdminOrderIssueView;

export type AdminOrderIssuePage = {
  items: ReadonlyArray<AdminOrderIssueView>;
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
  listAdminPayments(request: AdminPaymentListRequest): Promise<RpcResult<AdminPaymentPage>>;
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
