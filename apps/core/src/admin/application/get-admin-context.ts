import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  AdminContextView,
  AdminNavigationItem,
  AuthenticatedRequest,
  Capability,
  RpcResult,
} from "@freshmarkets/contracts";
import { applicationContext } from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";

export type AdminContextDeps = {
  auth: AuthInstance;
  db: D1Database;
  environment: string;
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
  capabilities: ReadonlyArray<Capability>;
}> = [
  { code: "overview", label: "Overview", href: "/admin", capabilities: [] },
  { code: "orders", label: "Orders", href: "/admin/orders", capabilities: ["orders.read", "orders.manage"] },
  { code: "catalog", label: "Catalog", href: "/admin/catalog", capabilities: ["catalog.read", "catalog.manage"] },
  { code: "inventory", label: "Inventory", href: "/admin/inventory", capabilities: ["inventory.read", "inventory.adjust"] },
  {
    code: "procurement",
    label: "Procurement",
    href: "/admin/procurement",
    capabilities: ["procurement.read", "procurement.manage"],
  },
  {
    code: "fulfillment",
    label: "Fulfillment",
    href: "/admin/fulfillment",
    capabilities: ["fulfillment.read", "fulfillment.manage"],
  },
  { code: "delivery", label: "Delivery", href: "/admin/delivery", capabilities: ["delivery.read", "delivery.manage"] },
  { code: "customers", label: "Customers", href: "/admin/customers", capabilities: ["customers.read", "customers.manage"] },
  {
    code: "memberships",
    label: "Memberships",
    href: "/admin/memberships",
    capabilities: ["memberships.read", "memberships.manage"],
  },
  { code: "payments", label: "Payments", href: "/admin/payments", capabilities: ["payments.read", "payments.manage"] },
  {
    code: "promotions",
    label: "Promotions",
    href: "/admin/promotions",
    capabilities: ["promotions.read", "promotions.manage"],
  },
  { code: "analytics", label: "Analytics", href: "/admin/analytics", capabilities: ["analytics.read"] },
  { code: "staff", label: "Staff", href: "/admin/staff", capabilities: ["staff.read", "staff.manage"] },
  { code: "audit", label: "Audit", href: "/admin/audit", capabilities: ["audit.read"] },
  { code: "settings", label: "Settings", href: "/admin/settings", capabilities: ["settings.read", "settings.manage"] },
];

export function adminNavigationFor(
  capabilities: ReadonlyArray<Capability>,
): ReadonlyArray<AdminNavigationItem> {
  return WORKSPACES.filter(
    (workspace) =>
      workspace.capabilities.length === 0 ||
      workspace.capabilities.some((capability) => capabilities.includes(capability)),
  ).map(({ code, label, href }) => ({ code, label, href }));
}

/** Staff context derived from the Better Auth session plus Application IAM. */
export async function getAdminContext(
  deps: AdminContextDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<AdminContextView>> {
  const database = drizzle(deps.db, { schema: iamSchema });
  const context = await applicationContext(deps.auth, database, request);
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

  const staff = await database
    .select()
    .from(iamSchema.staffIdentity)
    .where(eq(iamSchema.staffIdentity.authUserId, context.value.principal.userId))
    .limit(1);
  const staffRecord = staff[0];
  if (!staffRecord || staffRecord.status !== "active") {
    return {
      ok: false,
      error: { code: "FORBIDDEN", message: "Staff access is required", requestId: request.requestId },
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
