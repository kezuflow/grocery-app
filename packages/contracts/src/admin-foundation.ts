import type { RpcResult } from "./common";
import type { AuthenticatedRequest, Scope } from "./auth";

/**
 * The closed canonical admin capability vocabulary. Dot-form is the only
 * spelling authorized in new source and DTOs; historical colon-form
 * permission rows remain compatibility data mapped additively by migration.
 */
export const adminCapabilityCodes = [
  "customers.read",
  "customers.manage",
  "orders.read",
  "orders.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.adjust",
  "promotions.read",
  "promotions.manage",
  "memberships.read",
  "memberships.manage",
  "payments.read",
  "payments.manage",
  "refunds.manage",
  "fulfillment.read",
  "fulfillment.manage",
  "delivery.read",
  "delivery.manage",
  "procurement.read",
  "procurement.manage",
  "analytics.read",
  "staff.read",
  "staff.manage",
  "audit.read",
  "settings.read",
  "settings.manage",
] as const;

export type Capability = (typeof adminCapabilityCodes)[number];

const adminCapabilitySet: ReadonlySet<string> = new Set(adminCapabilityCodes);

export function isAdminCapability(value: string): value is Capability {
  return adminCapabilitySet.has(value);
}

export const adminNavigationSectionCodes = [
  "overview",
  "commerce",
  "operations",
  "finance",
  "administration",
] as const;

export type AdminNavigationSectionCode = (typeof adminNavigationSectionCodes)[number];

export const adminNavigationScopeKinds = ["GLOBAL", "MARKET", "LOCATION"] as const;

export type AdminNavigationScopeKind = (typeof adminNavigationScopeKinds)[number];

export type AdminNavigationItem = {
  code: string;
  label: string;
  href: string;
  section: AdminNavigationSectionCode;
  /** Selected Admin scopes where this Core-authorized entry is relevant. */
  scopeKinds: ReadonlyArray<AdminNavigationScopeKind>;
  parentCode: string | null;
  kind: "section" | "workspace" | "destination";
};

/** Staff session context derived in Core from Better Auth plus Application IAM. */
export type AdminContextView = {
  staffId: string;
  displayName: string;
  email: string;
  capabilities: ReadonlyArray<Capability>;
  scopes: ReadonlyArray<Scope>;
  navigation: ReadonlyArray<AdminNavigationItem>;
  environment: string;
};

/**
 * One selectable market or location scope option. Geometry, ranking rules,
 * and internal location-selection data are never exposed.
 */
export type AdminScopeOptionView =
  | {
      kind: "market";
      marketId: string;
      marketCode: string;
      marketName: string;
      currency: string;
      timezone: string;
    }
  | {
      kind: "location";
      marketId: string;
      marketCode: string;
      locationId: string;
      locationCode: string;
      locationName: string;
      currency: string;
      timezone: string;
    };

/** Explicit operator-selected scope carried by scoped Admin requests. */
export type AdminSelectedScope =
  | { kind: "GLOBAL" }
  | { kind: "MARKET"; marketId: string }
  | { kind: "LOCATION"; marketId: string; locationId: string };

/** Decision-facing Audit summary; sanitized metadata lives on the detail view. */
export type AdminAuditEventListItem = {
  auditEventId: string;
  /** ISO 8601 instant rendered from the stored UTC epoch value. */
  occurredAt: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  marketId: string | null;
  locationId: string | null;
  reason: string | null;
  correlationId: string | null;
};

export type AdminAuditEventPage = {
  items: ReadonlyArray<AdminAuditEventListItem>;
  nextCursor: string | null;
};

/**
 * Sanitized Audit detail. `metadata`/`before`/`after` are parsed, recursively
 * redacted structures — never raw JSON strings or persistence rows.
 */
export type AdminAuditEventView = AdminAuditEventListItem & {
  metadata: Readonly<Record<string, unknown>>;
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
};

export type AdminAuditListRequest = AuthenticatedRequest & {
  action?: string;
  resourceType?: string;
  actorId?: string;
  marketId?: string;
  locationId?: string;
  /** Inclusive lower bound as an ISO 8601 instant. */
  from?: string;
  /** Inclusive upper bound as an ISO 8601 instant. */
  to?: string;
  cursor?: string;
  /** Integer page size; Core bounds and defaults it. */
  limit?: number;
};

export type AdminAuditDetailRequest = AuthenticatedRequest & {
  auditEventId: string;
};

export type AdminFoundationService = {
  getAdminContext(request: AuthenticatedRequest): Promise<RpcResult<AdminContextView>>;
  listAdminScopes(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<AdminScopeOptionView>>>;
  listAdminAuditEvents(request: AdminAuditListRequest): Promise<RpcResult<AdminAuditEventPage>>;
  getAdminAuditEvent(request: AdminAuditDetailRequest): Promise<RpcResult<AdminAuditEventView>>;
};
