import type {
  AdminNavigationItem,
  AdminNavigationSectionCode,
  AdminSelectedScope,
} from "@freshmarkets/contracts";
import {
  BarChart3,
  BadgeDollarSign,
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

const CANONICAL_ORDER: ReadonlyArray<string> = [
  "overview",
  "products",
  "products-list",
  "products-create",
  "categories",
  "categories-create",
  "orders",
  "orders-list",
  "orders-issues",
  "customers",
  "customers-list",
  "memberships",
  "promotions",
  "location-products",
  "inventory",
  "delivery",
  "payments",
  "payments-overview",
  "payments-transactions",
  "payments-reconciliation",
  "commerce-configuration",
  "analytics",
  "staff",
  "staff-list",
  "staff-roles",
  "audit",
  "settings",
  "settings-fulfillment-mode",
];

const SECTION_ORDER: ReadonlyArray<AdminNavigationSectionCode> = [
  "overview",
  "commerce",
  "operations",
  "finance",
  "administration",
];

export const ADMIN_SECTION_LABELS: Readonly<Record<AdminNavigationSectionCode, string>> = {
  overview: "Overview",
  commerce: "Commerce",
  operations: "Operations",
  finance: "Finance",
  administration: "Administration",
};

const ICONS: Partial<Record<string, LucideIcon>> = {
  overview: LayoutDashboard,
  products: Boxes,
  "location-products": Boxes,
  orders: ClipboardList,
  inventory: Warehouse,
  delivery: Truck,
  customers: Users,
  memberships: ShieldCheck,
  payments: CreditCard,
  "commerce-configuration": BadgeDollarSign,
  promotions: BarChart3,
  analytics: BarChart3,
  staff: Users,
  audit: ScrollText,
  settings: Settings,
};

export type AdminNavigationEntry = AdminNavigationItem & { icon: LucideIcon };

export type AdminNavigationParent = AdminNavigationEntry & {
  children: ReadonlyArray<AdminNavigationEntry>;
};

export type AdminNavigationGroup = {
  code: AdminNavigationSectionCode;
  label: string;
  items: ReadonlyArray<AdminNavigationParent>;
};

/** Legacy exports remain empty so workspaces cannot invent child links in Web. */
export const STAFF_SUB_NAVIGATION: ReadonlyArray<AdminNavigationItem> = [];
export const CUSTOMER_SUB_NAVIGATION: ReadonlyArray<AdminNavigationItem> = [];

/**
 * Narrows Core-authorized navigation to entries Core marks as relevant to the
 * operator's selected scope. It never adds a route or grants authority.
 */
export function adminNavigationItemsForScope(
  items: ReadonlyArray<AdminNavigationItem>,
  selectedScope: AdminSelectedScope | null,
): ReadonlyArray<AdminNavigationItem> {
  if (!selectedScope) return items;
  const applicable = items.filter((item) => item.scopeKinds?.includes(selectedScope.kind) === true);
  const applicableCodes = new Set(applicable.map((item) => item.code));
  return applicable.filter(
    (item) => item.parentCode === null || applicableCodes.has(item.parentCode),
  );
}

export function adminNavigationFromContext(
  items: ReadonlyArray<AdminNavigationItem>,
): ReadonlyArray<AdminNavigationEntry> {
  return CANONICAL_ORDER.flatMap((code) => {
    const item = items.find((candidate) => candidate.code === code);
    if (!item) return [];
    const parent = item.parentCode
      ? items.find((candidate) => candidate.code === item.parentCode)
      : undefined;
    const icon = ICONS[item.code] ?? (parent ? ICONS[parent.code] : undefined);
    return icon ? [{ ...item, icon }] : [];
  });
}

export function groupAdminNavigation(
  items: ReadonlyArray<AdminNavigationEntry>,
): ReadonlyArray<AdminNavigationGroup> {
  return SECTION_ORDER.flatMap((section) => {
    const sectionItems = items.filter((item) => item.section === section);
    const parents = sectionItems
      .filter((item) => item.parentCode === null)
      .map((item) => ({
        ...item,
        children: sectionItems.filter((candidate) => candidate.parentCode === item.code),
      }));
    return parents.length > 0
      ? [{ code: section, label: ADMIN_SECTION_LABELS[section], items: parents }]
      : [];
  });
}

export function mostSpecificActiveNavigation(
  items: ReadonlyArray<AdminNavigationEntry>,
  pathname: string | null,
): { code: string; parentCode: string | null } | null {
  if (!pathname) return null;
  const active = items
    .filter(
      (item) =>
        pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((left, right) => {
      const specificity = right.href.length - left.href.length;
      if (specificity !== 0) return specificity;
      if (left.kind === right.kind) return 0;
      return left.kind === "destination" ? -1 : 1;
    })[0];
  return active ? { code: active.code, parentCode: active.parentCode } : null;
}
