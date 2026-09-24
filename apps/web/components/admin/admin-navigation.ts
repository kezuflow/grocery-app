import type {
  AdminNavigationItem,
  AdminNavigationSectionCode,
  AdminSelectedScope,
} from "@freshmarkets/contracts";
import {
  BarChart3,
  BadgePercent,
  Boxes,
  ClipboardList,
  CreditCard,
  Images,
  LayoutDashboard,
  MapPin,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export const ADMIN_SECTION_LABELS: Readonly<Record<AdminNavigationSectionCode, string>> = {
  home: "Home",
  orders: "Orders",
  products: "Products",
  customers: "Customers",
  discounts: "Discounts",
  content: "Content",
  analytics: "Analytics",
  settings: "Settings",
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
  transfers: Truck,
  procurement: ClipboardList,
  receiving: Warehouse,
  fulfillment: ClipboardList,
  delivery: Truck,
  customers: Users,
  memberships: ShieldCheck,
  payments: CreditCard,
  promotions: BarChart3,
  sales: BadgePercent,
  banners: Images,
  analytics: BarChart3,
  locations: MapPin,
  staff: Users,
  audit: ScrollText,
  settings: Settings,
};

const SECTION_ICONS: Record<AdminNavigationSectionCode, LucideIcon> = {
  home: LayoutDashboard,
  orders: ClipboardList,
  products: Boxes,
  customers: Users,
  discounts: BadgePercent,
  content: Images,
  analytics: BarChart3,
  settings: Settings,
  overview: LayoutDashboard,
  commerce: Boxes,
  operations: Warehouse,
  finance: CreditCard,
  administration: Settings,
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
  return items.map((item) => {
    const parent = item.parentCode
      ? items.find((candidate) => candidate.code === item.parentCode)
      : undefined;
    const icon =
      ICONS[item.code] ?? (parent ? ICONS[parent.code] : undefined) ?? SECTION_ICONS[item.section];
    return { ...item, icon };
  });
}

export function groupAdminNavigation(
  items: ReadonlyArray<AdminNavigationEntry>,
): ReadonlyArray<AdminNavigationGroup> {
  // Core sends the canonical order; preserve its first section occurrence.
  return [...new Set(items.map((item) => item.section))].flatMap((section) => {
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

/** A redirect-only Settings root and duplicate parent URLs are not search results. */
export function commandPaletteEntries(
  group: AdminNavigationGroup,
): ReadonlyArray<AdminNavigationEntry> {
  return group.items.flatMap((item) => [
    ...(item.code === "settings" || item.children.some((child) => child.href === item.href)
      ? []
      : [item]),
    ...item.children,
  ]);
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
