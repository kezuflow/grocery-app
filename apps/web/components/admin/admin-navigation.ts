import type { AdminNavigationItem } from "@freshmarkets/contracts";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  PackageCheck,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * Presentation mapping only: Core decides which workspaces exist and in what
 * payload order they arrive; this helper orders them canonically and attaches
 * icons. Unknown codes are dropped, never invented.
 */
const CANONICAL_ORDER: ReadonlyArray<string> = [
  "overview",
  "orders",
  "catalog",
  "inventory",
  "procurement",
  "fulfillment",
  "delivery",
  "customers",
  "memberships",
  "payments",
  "promotions",
  "analytics",
  "staff",
  "audit",
  "settings",
];

const ICONS: Partial<Record<string, LucideIcon>> = {
  overview: LayoutDashboard,
  orders: ClipboardList,
  catalog: Boxes,
  inventory: Warehouse,
  procurement: PackageCheck,
  fulfillment: PackageCheck,
  delivery: Truck,
  customers: Users,
  memberships: ShieldCheck,
  payments: CreditCard,
  promotions: BarChart3,
  analytics: BarChart3,
  staff: Users,
  audit: ScrollText,
  settings: Settings,
};

export type AdminNavigationEntry = AdminNavigationItem & { icon: LucideIcon };

/** Workspace-scoped sub-navigation for the Staff & Access section. */
export const STAFF_SUB_NAVIGATION: ReadonlyArray<AdminNavigationItem> = [
  { code: "staff", label: "Staff", href: "/admin/staff" },
  { code: "staff-roles", label: "Roles", href: "/admin/staff/roles" },
];

export function adminNavigationFromContext(
  items: ReadonlyArray<AdminNavigationItem>,
): ReadonlyArray<AdminNavigationEntry> {
  return CANONICAL_ORDER.flatMap((code) => {
    const item = items.find((candidate) => candidate.code === code);
    const icon = ICONS[code];
    return item && icon ? [{ ...item, icon }] : [];
  });
}
