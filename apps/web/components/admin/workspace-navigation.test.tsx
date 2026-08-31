import { describe, expect, it, vi } from "vitest";
import type { AdminNavigationItem } from "@freshmarkets/contracts";
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/customers" }));
import { workspaceTabsFromNavigation } from "./workspace-navigation";

const navigation: AdminNavigationItem[] = [
  {
    code: "customers",
    label: "Customers",
    href: "/admin/customers",
    section: "commerce",
    parentCode: null,
    kind: "workspace",
  },
  {
    code: "customers-list",
    label: "Customer list",
    href: "/admin/customers",
    section: "commerce",
    parentCode: "customers",
    kind: "destination",
  },
  {
    code: "customers-privacy",
    label: "Privacy queue",
    href: "/admin/customers/privacy",
    section: "commerce",
    parentCode: "customers",
    kind: "destination",
  },
  {
    code: "staff",
    label: "Staff",
    href: "/admin/staff",
    section: "administration",
    parentCode: null,
    kind: "workspace",
  },
];

describe("workspaceTabsFromNavigation", () => {
  it("uses only Core-provided destinations and deduplicates the parent route", () => {
    expect(
      workspaceTabsFromNavigation(navigation, "customers", "/admin/customers/privacy"),
    ).toEqual({
      activeId: "customers-privacy",
      tabs: [
        { id: "customers-list", label: "Customer list", href: "/admin/customers" },
        { id: "customers-privacy", label: "Privacy queue", href: "/admin/customers/privacy" },
      ],
    });
  });

  it("returns no invented tabs when Core did not authorize child destinations", () => {
    expect(workspaceTabsFromNavigation(navigation, "staff", "/admin/staff")).toEqual({
      activeId: "staff",
      tabs: [{ id: "staff", label: "Staff", href: "/admin/staff" }],
    });
  });
});
