import { drizzle } from "drizzle-orm/d1";
import type {
  AdminContextView,
  AdminNavigationItem,
  AdminNavigationScopeKind,
  AuthenticatedRequest,
  Capability,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";

export type AdminContextDeps = {
  auth: AuthInstance;
  db: D1Database;
  environment: string;
  accessContext?: ResolvedApplicationContext;
};

/**
 * Closed admin navigation vocabulary in canonical display order. `overview`
 * is always present for active Staff; every other workspace appears only when
 * its read or manage capability is held. Web renders these items verbatim and
 * never derives permissions from their visibility.
 */
const WORKSPACES: ReadonlyArray<{
  code: string;
  label: string;
  href: string;
  section: AdminNavigationItem["section"];
  parentCode: string | null;
  kind: AdminNavigationItem["kind"];
  capabilities: ReadonlyArray<Capability>;
  capabilityMode?: "ANY" | "ALL";
}> = [
  {
    code: "overview",
    label: "Overview",
    href: "/admin",
    section: "overview",
    parentCode: null,
    kind: "workspace",
    capabilities: [],
  },
  {
    code: "orders",
    label: "Orders",
    href: "/admin/orders",
    section: "commerce",
    parentCode: null,
    kind: "workspace",
    capabilities: ["orders.read", "orders.manage"],
  },
  {
    code: "orders-list",
    label: "Order list",
    href: "/admin/orders",
    section: "commerce",
    parentCode: "orders",
    kind: "destination",
    capabilities: ["orders.read", "orders.manage"],
  },
  {
    code: "orders-issues",
    label: "Order issues",
    href: "/admin/issues",
    section: "commerce",
    parentCode: "orders",
    kind: "destination",
    capabilities: ["orders.read", "orders.manage"],
  },
  {
    code: "products",
    label: "Products",
    href: "/admin/catalog/products",
    section: "commerce",
    parentCode: null,
    kind: "workspace",
    capabilities: ["catalog.read", "catalog.manage"],
  },
  {
    code: "products-list",
    label: "Product list",
    href: "/admin/catalog/products",
    section: "commerce",
    parentCode: "products",
    kind: "destination",
    capabilities: ["catalog.read", "catalog.manage"],
  },
  {
    code: "products-create",
    label: "Add product",
    href: "/admin/catalog/products/new",
    section: "commerce",
    parentCode: "products",
    kind: "destination",
    capabilities: ["catalog.manage"],
  },
  {
    code: "categories",
    label: "Categories",
    href: "/admin/catalog/categories",
    section: "commerce",
    parentCode: "products",
    kind: "destination",
    capabilities: ["catalog.read", "catalog.manage"],
  },
  {
    code: "categories-create",
    label: "Add category",
    href: "/admin/catalog/categories/new",
    section: "commerce",
    parentCode: "products",
    kind: "destination",
    capabilities: ["catalog.manage"],
  },
  {
    code: "inventory",
    label: "Inventory",
    href: "/admin/inventory",
    section: "operations",
    parentCode: null,
    kind: "workspace",
    capabilities: ["inventory.read", "inventory.adjust"],
  },
  {
    code: "location-products",
    label: "Products",
    href: "/admin/catalog/products",
    section: "operations",
    parentCode: null,
    kind: "workspace",
    capabilities: ["catalog.read", "inventory.read"],
    capabilityMode: "ALL",
  },
  {
    code: "delivery",
    label: "Delivery",
    href: "/admin/delivery",
    section: "operations",
    parentCode: null,
    kind: "workspace",
    capabilities: ["delivery.read", "delivery.manage"],
  },
  {
    code: "customers",
    label: "Customers",
    href: "/admin/customers",
    section: "commerce",
    parentCode: null,
    kind: "workspace",
    capabilities: ["customers.read", "customers.manage", "memberships.read", "memberships.manage"],
  },
  {
    code: "customers-list",
    label: "Customer list",
    href: "/admin/customers",
    section: "commerce",
    parentCode: "customers",
    kind: "destination",
    capabilities: ["customers.read", "customers.manage"],
  },
  {
    code: "memberships",
    label: "Memberships",
    href: "/admin/memberships",
    section: "commerce",
    parentCode: "customers",
    kind: "destination",
    capabilities: ["memberships.read", "memberships.manage"],
  },
  {
    code: "payments",
    label: "Payments",
    href: "/admin/payments",
    section: "finance",
    parentCode: null,
    kind: "workspace",
    capabilities: ["payments.read", "payments.manage"],
  },
  {
    code: "payments-overview",
    label: "Overview",
    href: "/admin/payments/overview",
    section: "finance",
    parentCode: "payments",
    kind: "destination",
    capabilities: ["payments.read", "payments.manage"],
  },
  {
    code: "payments-transactions",
    label: "Transactions",
    href: "/admin/payments/transactions",
    section: "finance",
    parentCode: "payments",
    kind: "destination",
    capabilities: ["payments.read", "payments.manage"],
  },
  {
    code: "payments-reconciliation",
    label: "Reconciliation",
    href: "/admin/payments/reconciliation",
    section: "finance",
    parentCode: "payments",
    kind: "destination",
    capabilities: ["payments.read", "payments.manage"],
  },
  {
    code: "commerce-configuration",
    label: "Pricing & fees",
    href: "/admin/commerce-configuration",
    section: "finance",
    parentCode: null,
    kind: "workspace",
    capabilities: ["memberships.read", "payments.read"],
  },
  {
    code: "promotions",
    label: "Promotions",
    href: "/admin/promotions",
    section: "commerce",
    parentCode: null,
    kind: "workspace",
    capabilities: ["promotions.read", "promotions.manage"],
  },
  {
    code: "analytics",
    label: "Analytics",
    href: "/admin/analytics",
    section: "finance",
    parentCode: null,
    kind: "workspace",
    capabilities: ["analytics.read"],
  },
  {
    code: "staff",
    label: "Staff",
    href: "/admin/staff",
    section: "administration",
    parentCode: null,
    kind: "workspace",
    capabilities: ["staff.read", "staff.manage"],
  },
  {
    code: "staff-list",
    label: "Staff",
    href: "/admin/staff",
    section: "administration",
    parentCode: "staff",
    kind: "destination",
    capabilities: ["staff.read", "staff.manage"],
  },
  {
    code: "staff-roles",
    label: "Roles",
    href: "/admin/staff/roles",
    section: "administration",
    parentCode: "staff",
    kind: "destination",
    capabilities: ["staff.read", "staff.manage"],
  },
  {
    code: "audit",
    label: "Audit log",
    href: "/admin/audit",
    section: "administration",
    parentCode: null,
    kind: "workspace",
    capabilities: ["audit.read"],
  },
  {
    code: "settings",
    label: "Settings",
    href: "/admin/settings",
    section: "administration",
    parentCode: null,
    kind: "workspace",
    capabilities: ["settings.read", "settings.manage"],
  },
  {
    code: "settings-fulfillment-mode",
    label: "Fulfillment mode",
    href: "/admin/settings/fulfillment-mode",
    section: "administration",
    parentCode: "settings",
    kind: "destination",
    capabilities: ["settings.read", "settings.manage"],
  },
];

const ALL_SCOPE_NAVIGATION_CODES: ReadonlySet<string> = new Set([
  "overview",
  "orders",
  "orders-list",
  "orders-issues",
  "analytics",
  "audit",
]);

const LOCATION_ONLY_NAVIGATION_CODES: ReadonlySet<string> = new Set([
  "location-products",
  "inventory",
  "delivery",
]);

const GLOBAL_AND_LOCATION_NAVIGATION_CODES: ReadonlySet<string> = new Set(["settings"]);

function navigationScopeKindsFor(code: string): ReadonlyArray<AdminNavigationScopeKind> {
  if (ALL_SCOPE_NAVIGATION_CODES.has(code)) return ["GLOBAL", "MARKET", "LOCATION"];
  if (LOCATION_ONLY_NAVIGATION_CODES.has(code)) return ["LOCATION"];
  if (GLOBAL_AND_LOCATION_NAVIGATION_CODES.has(code)) return ["GLOBAL", "LOCATION"];
  return ["GLOBAL"];
}

export function adminNavigationFor(
  capabilities: ReadonlyArray<Capability>,
): ReadonlyArray<AdminNavigationItem> {
  return WORKSPACES.filter(
    (workspace) =>
      workspace.capabilities.length === 0 ||
      (workspace.capabilityMode === "ALL"
        ? workspace.capabilities.every((capability) => capabilities.includes(capability))
        : workspace.capabilities.some((capability) => capabilities.includes(capability))),
  ).map(({ code, label, href, section, parentCode, kind }) => ({
    code,
    label,
    href,
    section,
    scopeKinds: navigationScopeKindsFor(code),
    parentCode,
    kind,
  }));
}

/** Staff context derived from the Better Auth session plus Application IAM. */
export async function getAdminContext(
  deps: AdminContextDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<AdminContextView>> {
  const database = drizzle(deps.db, { schema: iamSchema });
  const context = await applicationContextForRequest(
    deps.auth,
    database,
    request,
    deps.accessContext,
  );
  if (!context.ok) return context;
  if (!context.value.authenticated || !context.value.principal) {
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: request.requestId,
      },
    };
  }

  const staffRecord = context.value.staffIdentity;
  if (!staffRecord || staffRecord.status !== "active") {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Staff access is required",
        requestId: request.requestId,
      },
    };
  }

  return {
    ok: true,
    value: {
      staffId: staffRecord.id,
      displayName: staffRecord.displayName,
      email: context.value.principal.email,
      capabilities: context.value.capabilities,
      scopes: context.value.scopes,
      navigation: adminNavigationFor(context.value.capabilities),
      environment: deps.environment,
    },
    requestId: request.requestId,
  };
}
