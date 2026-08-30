import type { AuthenticatedRequest, Scope } from "./auth";
import type { Capability } from "./admin-foundation";
import type { RpcResult } from "./common";

export const adminStaffInvitationStatuses = ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"] as const;
export type AdminStaffInvitationStatus = (typeof adminStaffInvitationStatuses)[number];

export const adminRoleStatuses = ["ACTIVE", "ARCHIVED"] as const;
export type AdminRoleStatus = (typeof adminRoleStatuses)[number];

export const adminStaffAccessActions = ["ACTIVATE", "SUSPEND"] as const;
export type AdminStaffAccessAction = (typeof adminStaffAccessActions)[number];

/** Application-owned staff identity status; never a Better Auth field. */
export type AdminStaffStatus = "active" | "suspended";

/**
 * Staff identity read model. `email` is the only Better-Auth-sourced display
 * field; credentials, sessions, and account internals are never exposed.
 */
export type AdminStaffSummary = {
  staffId: string;
  authUserId: string;
  displayName: string;
  email: string;
  status: AdminStaffStatus;
  roleCodes: ReadonlyArray<string>;
  capabilityCodes: ReadonlyArray<Capability>;
  scopes: ReadonlyArray<Scope>;
  version: number;
  createdAt: string;
};

export type AdminStaffDetail = AdminStaffSummary;

export type AdminStaffPage = {
  items: ReadonlyArray<AdminStaffSummary>;
  nextCursor: string | null;
};

export type AdminStaffInvitationView = {
  invitationId: string;
  email: string;
  displayName: string;
  status: AdminStaffInvitationStatus;
  invitedByStaffId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type AdminStaffInvitationPage = {
  items: ReadonlyArray<AdminStaffInvitationView>;
  nextCursor: string | null;
};

export type AdminRoleSummary = {
  roleId: string;
  code: string;
  name: string;
  description: string;
  status: AdminRoleStatus;
  capabilityCodes: ReadonlyArray<Capability>;
  version: number;
};

export type AdminRoleDetail = AdminRoleSummary;

export type AdminRolePage = {
  items: ReadonlyArray<AdminRoleSummary>;
  nextCursor: string | null;
};

export type CapabilityDefinitionView = {
  code: Capability;
  description: string;
};

export type SessionRevocationResult = {
  revokedSessionCount: number;
};

export type AdminStaffListRequest = AuthenticatedRequest & {
  cursor?: string;
  /** Integer page size; Core bounds and defaults it. */
  limit?: number;
};

export type AdminStaffDetailRequest = AuthenticatedRequest & {
  staffId: string;
};

export type AdminStaffInviteRequest = AuthenticatedRequest & {
  email: string;
  displayName: string;
  idempotencyKey: string;
};

export type AdminStaffInvitationListRequest = AuthenticatedRequest & {
  cursor?: string;
  limit?: number;
};

export type AdminStaffInvitationRevokeRequest = AuthenticatedRequest & {
  invitationId: string;
  reason: string;
  idempotencyKey: string;
};

export type AdminStaffUpdateRequest = AuthenticatedRequest & {
  staffId: string;
  displayName: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminStaffAccessChangeRequest = AuthenticatedRequest & {
  staffId: string;
  action: AdminStaffAccessAction;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminStaffRolesRequest = AuthenticatedRequest & {
  staffId: string;
  roleIds: ReadonlyArray<string>;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminStaffScopesRequest = AuthenticatedRequest & {
  staffId: string;
  scopes: ReadonlyArray<Scope>;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminStaffSessionRevocationRequest = AuthenticatedRequest & {
  staffId: string;
  reason: string;
  idempotencyKey: string;
};

export type AdminRoleListRequest = AuthenticatedRequest & {
  cursor?: string;
  limit?: number;
};

export type AdminRoleDetailRequest = AuthenticatedRequest & {
  roleId: string;
};

export type AdminRoleCreateRequest = AuthenticatedRequest & {
  code: string;
  name: string;
  description: string;
  capabilityCodes: ReadonlyArray<Capability>;
  idempotencyKey: string;
};

export type AdminRoleUpdateRequest = AuthenticatedRequest & {
  roleId: string;
  name: string;
  description: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminRoleCapabilitiesRequest = AuthenticatedRequest & {
  roleId: string;
  capabilityCodes: ReadonlyArray<Capability>;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminRoleArchiveRequest = AuthenticatedRequest & {
  roleId: string;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

/**
 * Staff & Access administration. Every method derives the caller from the
 * forwarded session, requires the named capability plus a global scope in
 * Core, and returns purpose-built DTOs or stable error codes.
 */
export type AdminStaffAccessService = {
  listAdminStaff(request: AdminStaffListRequest): Promise<RpcResult<AdminStaffPage>>;
  getAdminStaff(request: AdminStaffDetailRequest): Promise<RpcResult<AdminStaffDetail>>;
  listAdminStaffInvitations(
    request: AdminStaffInvitationListRequest,
  ): Promise<RpcResult<AdminStaffInvitationPage>>;
  inviteAdminStaff(request: AdminStaffInviteRequest): Promise<RpcResult<AdminStaffInvitationView>>;
  revokeAdminStaffInvitation(
    request: AdminStaffInvitationRevokeRequest,
  ): Promise<RpcResult<AdminStaffInvitationView>>;
  updateAdminStaff(request: AdminStaffUpdateRequest): Promise<RpcResult<AdminStaffDetail>>;
  changeAdminStaffAccess(
    request: AdminStaffAccessChangeRequest,
  ): Promise<RpcResult<AdminStaffDetail>>;
  setAdminStaffRoles(request: AdminStaffRolesRequest): Promise<RpcResult<AdminStaffDetail>>;
  setAdminStaffScopes(request: AdminStaffScopesRequest): Promise<RpcResult<AdminStaffDetail>>;
  revokeAdminStaffSessions(
    request: AdminStaffSessionRevocationRequest,
  ): Promise<RpcResult<SessionRevocationResult>>;
  listAdminRoles(request: AdminRoleListRequest): Promise<RpcResult<AdminRolePage>>;
  getAdminRole(request: AdminRoleDetailRequest): Promise<RpcResult<AdminRoleDetail>>;
  createAdminRole(request: AdminRoleCreateRequest): Promise<RpcResult<AdminRoleDetail>>;
  updateAdminRole(request: AdminRoleUpdateRequest): Promise<RpcResult<AdminRoleDetail>>;
  setAdminRoleCapabilities(
    request: AdminRoleCapabilitiesRequest,
  ): Promise<RpcResult<AdminRoleDetail>>;
  archiveAdminRole(request: AdminRoleArchiveRequest): Promise<RpcResult<AdminRoleDetail>>;
  listCapabilityDefinitions(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CapabilityDefinitionView>>>;
};
