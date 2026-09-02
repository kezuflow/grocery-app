import { describe, expect, it, vi } from "vitest";
import type { AdminNavigationItem } from "@freshmarkets/contracts";
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/customers" }));
import { workspaceTabsFromNavigation } from "./workspace-navigation";

const globalScope = ["GLOBAL"] as const;

const navigation: AdminNavigationItem[] = [
  {
    code: "customers",
    label: "Customers",
    href: "/admin/customers",
    section: "commerce",
    scopeKinds: globalScope,
    parentCode: null,
    kind: "workspace",
  },
  {
    code: "customers-list",
    label: "Customer list",
    href: "/admin/customers",
    section: "commerce",
    scopeKinds: globalScope,
    parentCode: "customers",
    kind: "destination",
  },
  {
    code: "customers-privacy",
    label: "Privacy requests",
    href: "/admin/customers/privacy",
    section: "commerce",
    scopeKinds: globalScope,
    parentCode: "customers",
    kind: "destination",
  },
  {
    code: "memberships",
    label: "Memberships",
    href: "/admin/memberships",
    section: "commerce",
    scopeKinds: globalScope,
    parentCode: "customers",
    kind: "destination",
  },
  {
    code: "staff",
    label: "Staff",
    href: "/admin/staff",
    section: "administration",
    scopeKinds: globalScope,
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
        { id: "customers-privacy", label: "Privacy requests", href: "/admin/customers/privacy" },
        { id: "memberships", label: "Memberships", href: "/admin/memberships" },
      ],
    });
  });

  it("marks Memberships active inside Customer administration", () => {
    expect(workspaceTabsFromNavigation(navigation, "customers", "/admin/memberships")).toEqual({
      activeId: "memberships",
      tabs: [
        { id: "customers-list", label: "Customer list", href: "/admin/customers" },
        { id: "customers-privacy", label: "Privacy requests", href: "/admin/customers/privacy" },
        { id: "memberships", label: "Memberships", href: "/admin/memberships" },
      ],
    });
  });

  it("returns no invented tabs when Core did not authorize child destinations", () => {
    expect(workspaceTabsFromNavigation(navigation, "staff", "/admin/staff")).toEqual({
      activeId: "staff",
      tabs: [{ id: "staff", label: "Staff", href: "/admin/staff" }],
    });
  });

  it("presents Categories as a Products tab", () => {
    expect(
      workspaceTabsFromNavigation(
        [
          {
            code: "products",
            label: "Products",
            href: "/admin/catalog/products",
            section: "commerce",
            scopeKinds: globalScope,
            parentCode: null,
            kind: "workspace",
          },
          {
            code: "products-list",
            label: "Product list",
            href: "/admin/catalog/products",
            section: "commerce",
            scopeKinds: globalScope,
            parentCode: "products",
            kind: "destination",
          },
          {
            code: "categories",
            label: "Categories",
            href: "/admin/catalog/categories",
            section: "commerce",
            scopeKinds: globalScope,
            parentCode: "products",
            kind: "destination",
          },
        ],
        "products",
        "/admin/catalog/categories",
      ),
    ).toEqual({
      activeId: "categories",
      tabs: [
        { id: "products-list", label: "Product list", href: "/admin/catalog/products" },
        { id: "categories", label: "Categories", href: "/admin/catalog/categories" },
      ],
    });
  });
});
