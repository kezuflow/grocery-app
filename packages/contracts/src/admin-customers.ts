import type { AuthenticatedRequest } from "./auth";
import type { AdminAuditEventListItem } from "./admin-foundation";
import type { RpcResult } from "./common";

export const customerClosureRequestTypes = [
  "ACCESS",
  "CORRECTION",
  "CLOSURE",
  "ANONYMIZATION",
] as const;
export type CustomerClosureRequestType = (typeof customerClosureRequestTypes)[number];

export const privacyRequestStatuses = [
  "SUBMITTED",
  "VERIFYING",
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "COMPLETED",
  "ESCALATED",
] as const;
export type PrivacyRequestStatus = (typeof privacyRequestStatuses)[number];

export const privacyRequestActions = [
  "VERIFY",
  "APPROVE",
  "REJECT",
  "BEGIN_PROCESSING",
  "COMPLETE",
  "ESCALATE",
] as const;
export type PrivacyRequestAction = (typeof privacyRequestActions)[number];

/** Commerce access status mirrored from the customer_principal gate. */
export type CustomerAccessStatus = "active" | "disabled";

/**
 * Composed customer summary. Lifetime spend/AOV are deliberately excluded
 * until their canonical metric definitions are approved. Better Auth supplies
 * only the display `email`.
 */
export type AdminCustomerSummary = {
  customerId: string;
  authUserId: string;
  email: string;
  phone: string | null;
  accessStatus: CustomerAccessStatus;
  subscriptionState: string | null;
  orderCount: number;
  lastOrderAt: string | null;
  version: number;
  createdAt: string;
};

export type AdminCustomerDetail = AdminCustomerSummary & {
  /** Ten most recent sanitized Audit summaries for the customer's auth user. */
  recentAudit: ReadonlyArray<AdminAuditEventListItem>;
};

export type AdminCustomerPage = {
  items: ReadonlyArray<AdminCustomerSummary>;
  nextCursor: string | null;
};

export type CustomerInvitationView = {
  invitationId: string;
  version: number;
  email: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  invitedByStaffId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type CustomerInvitationPage = {
  items: ReadonlyArray<CustomerInvitationView>;
  nextCursor: string | null;
};

export type PrivacyRequestView = {
  privacyRequestId: string;
  customerId: string;
  requestType: CustomerClosureRequestType;
  status: PrivacyRequestStatus;
  requestedAt: string;
  verifiedAt: string | null;
  resolvedAt: string | null;
  assignedStaffId: string | null;
  reason: string | null;
  resolution: string | null;
  version: number;
};

export type PrivacyRequestPage = {
  items: ReadonlyArray<PrivacyRequestView>;
  nextCursor: string | null;
};

export type AdminCustomerListRequest = AuthenticatedRequest & {
  query?: string;
  cursor?: string;
  limit?: number;
};

export type AdminCustomerDetailRequest = AuthenticatedRequest & {
  customerId: string;
};

export type AdminCustomerInviteRequest = AuthenticatedRequest & {
  email: string;
  idempotencyKey: string;
};

export type AdminCustomerInvitationListRequest = AuthenticatedRequest & {
  cursor?: string;
  limit?: number;
};

export type CustomerInvitationOffer = {
  invitationId: string;
  expectedVersion: number;
  expiresAt: string;
};

export type AcceptCustomerInvitationRequest = AuthenticatedRequest & {
  invitationId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type RevokeCustomerInvitationRequest = AcceptCustomerInvitationRequest & { reason: string };

export type AdminCustomerAccessChangeRequest = AuthenticatedRequest & {
  customerId: string;
  action: "DISABLE" | "RESTORE";
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminCustomerSessionRevocationRequest = AuthenticatedRequest & {
  customerId: string;
  reason: string;
  idempotencyKey: string;
};

export type AdminClosureRequestCommand = AuthenticatedRequest & {
  customerId: string;
  requestType: CustomerClosureRequestType;
  reason: string;
  idempotencyKey: string;
};

export type AdminPrivacyListRequest = AuthenticatedRequest & {
  status?: PrivacyRequestStatus;
  cursor?: string;
  limit?: number;
};

export type AdminPrivacyActionRequest = AuthenticatedRequest & {
  privacyRequestId: string;
  action: PrivacyRequestAction;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

/**
 * Customer CRM and invitation onboarding. Administrative methods require the
 * named capability and Global scope. Invitation review/acceptance instead use
 * the invitee's verified session identity. No credential surface is exposed.
 */
export type AdminCustomerService = {
  revokeCustomerInvitation(
    request: RevokeCustomerInvitationRequest,
  ): Promise<RpcResult<CustomerInvitationView>>;
  getMyCustomerInvitation(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<CustomerInvitationOffer | null>>;
  acceptCustomerInvitation(
    request: AcceptCustomerInvitationRequest,
  ): Promise<RpcResult<{ customerId: string; invitationId: string }>>;
  listAdminCustomers(request: AdminCustomerListRequest): Promise<RpcResult<AdminCustomerPage>>;
  getAdminCustomer(request: AdminCustomerDetailRequest): Promise<RpcResult<AdminCustomerDetail>>;
  listCustomerInvitations(
    request: AdminCustomerInvitationListRequest,
  ): Promise<RpcResult<CustomerInvitationPage>>;
  inviteCustomer(request: AdminCustomerInviteRequest): Promise<RpcResult<CustomerInvitationView>>;
  changeCustomerAccess(
    request: AdminCustomerAccessChangeRequest,
  ): Promise<RpcResult<AdminCustomerSummary>>;
  revokeCustomerSessions(
    request: AdminCustomerSessionRevocationRequest,
  ): Promise<RpcResult<{ revokedSessionCount: number }>>;
  requestCustomerClosure(
    request: AdminClosureRequestCommand,
  ): Promise<RpcResult<PrivacyRequestView>>;
};

export type AdminPrivacyService = {
  listPrivacyRequests(request: AdminPrivacyListRequest): Promise<RpcResult<PrivacyRequestPage>>;
  applyPrivacyAction(request: AdminPrivacyActionRequest): Promise<RpcResult<PrivacyRequestView>>;
};
