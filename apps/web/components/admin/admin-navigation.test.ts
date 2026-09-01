import { describe, expect, it } from "vitest";
import {
  adminNavigationFromContext,
  adminNavigationItemsForScope,
  groupAdminNavigation,
  mostSpecificActiveNavigation,
} from "./admin-navigation";

const allScopes = ["GLOBAL", "MARKET", "LOCATION"] as const;
const globalScope = ["GLOBAL"] as const;

const overview = {
  code: "overview",
  label: "Overview",
  href: "/admin",
  section: "overview" as const,
  scopeKinds: allScopes,
  parentCode: null,
  kind: "workspace" as const,
};

const audit = {
  code: "audit",
  label: "Audit log",
  href: "/admin/audit",
  section: "administration" as const,
  scopeKinds: allScopes,
  parentCode: null,
  kind: "workspace" as const,
};

describe("admin navigation mapping", () => {
  it("renders only Core-provided navigation in canonical order", () => {
    expect(adminNavigationFromContext([audit, overview]).map((item) => item.code)).toEqual([
      "overview",
      "audit",
    ]);
  });

  it("drops unknown codes and keeps Core labels and hrefs verbatim", () => {
    const items = adminNavigationFromContext([
      {
        code: "not-a-workspace",
        label: "Mystery",
        href: "/admin/mystery",
        section: "commerce",
        scopeKinds: allScopes,
        parentCode: null,
        kind: "workspace",
      },
      {
        code: "orders",
        label: "Orders",
        href: "/admin/orders",
        section: "commerce",
        scopeKinds: allScopes,
        parentCode: null,
        kind: "workspace",
      },
    ]);
    expect(items.map((item) => item.code)).toEqual(["orders"]);
    expect(items[0]).toMatchObject({ label: "Orders", href: "/admin/orders" });
    expect(items[0].icon).toBeTruthy();
  });

  it("returns an empty navigation for an empty Core payload", () => {
    expect(adminNavigationFromContext([])).toEqual([]);
  });

  it("renders the Core-authorized Pricing & fees workspace", () => {
    const items = adminNavigationFromContext([
      {
        code: "commerce-configuration",
        label: "Pricing & fees",
        href: "/admin/commerce-configuration",
        section: "finance",
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace",
      },
    ]);
    expect(items[0]).toMatchObject({
      code: "commerce-configuration",
      label: "Pricing & fees",
      href: "/admin/commerce-configuration",
    });
    expect(items[0]?.icon).toBeTruthy();
  });

  it("groups only Core-provided entries under their canonical sections and parents", () => {
    const groups = groupAdminNavigation(
      adminNavigationFromContext([
        overview,
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
      ]),
    );

    expect(groups.map((group) => group.code)).toEqual(["overview", "commerce"]);
    expect(groups[1]?.items[0]?.children.map((child) => child.code)).toEqual(["products-list"]);
  });

  it("groups Categories inside Products instead of creating a top-level workspace", () => {
    const groups = groupAdminNavigation(
      adminNavigationFromContext([
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
          code: "categories",
          label: "Categories",
          href: "/admin/catalog/categories",
          section: "commerce",
          scopeKinds: globalScope,
          parentCode: "products",
          kind: "destination",
        },
      ]),
    );

    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.code).toBe("products");
    expect(groups[0]?.items[0]?.children.map((child) => child.code)).toEqual(["categories"]);
  });

  it("selects the most-specific route and reports its parent", () => {
    const items = adminNavigationFromContext([
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
        code: "products-create",
        label: "Add product",
        href: "/admin/catalog/products/new",
        section: "commerce",
        scopeKinds: globalScope,
        parentCode: "products",
        kind: "destination",
      },
    ]);

    expect(mostSpecificActiveNavigation(items, "/admin/catalog/products/new")).toEqual({
      code: "products-create",
      parentCode: "products",
    });
  });

  it("prefers an exact destination over its equal-href workspace parent", () => {
    const items = adminNavigationFromContext([
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
    ]);

    expect(mostSpecificActiveNavigation(items, "/admin/catalog/products")).toEqual({
      code: "products-list",
      parentCode: "products",
    });
  });

  it("shows only Core-declared location navigation for Cebu Central", () => {
    const items = [
      overview,
      {
        code: "orders",
        label: "Orders",
        href: "/admin/orders",
        section: "commerce" as const,
        scopeKinds: allScopes,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "products",
        label: "Products",
        href: "/admin/catalog/products",
        section: "commerce" as const,
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "customers",
        label: "Customers",
        href: "/admin/customers",
        section: "commerce" as const,
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "memberships",
        label: "Memberships",
        href: "/admin/memberships",
        section: "commerce" as const,
        scopeKinds: globalScope,
        parentCode: "customers",
        kind: "destination" as const,
      },
      {
        code: "promotions",
        label: "Promotions",
        href: "/admin/promotions",
        section: "commerce" as const,
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "inventory",
        label: "Inventory",
        href: "/admin/inventory",
        section: "operations" as const,
        scopeKinds: ["LOCATION"] as const,
        parentCode: null,
        kind: "workspace" as const,
      },
      audit,
    ];

    expect(
      adminNavigationItemsForScope(items, {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      }).map((item) => item.code),
    ).toEqual(["overview", "orders", "inventory", "audit"]);
  });

  it("groups Memberships inside Customers instead of creating a top-level workspace", () => {
    const groups = groupAdminNavigation(
      adminNavigationFromContext([
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
          code: "memberships",
          label: "Memberships",
          href: "/admin/memberships",
          section: "commerce",
          scopeKinds: globalScope,
          parentCode: "customers",
          kind: "destination",
        },
      ]),
    );

    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.code).toBe("customers");
    expect(groups[0]?.items[0]?.children.map((child) => child.code)).toEqual(["memberships"]);
  });

  it("hides location-only Inventory when Global is selected", () => {
    expect(
      adminNavigationItemsForScope(
        [
          {
            code: "inventory",
            label: "Inventory",
            href: "/admin/inventory",
            section: "operations",
            scopeKinds: ["LOCATION"],
            parentCode: null,
            kind: "workspace",
          },
        ],
        { kind: "GLOBAL" },
      ),
    ).toEqual([]);
  });

  it("fails closed for a stale scoped payload without applicability metadata", () => {
    const staleItem = {
      code: "customers",
      label: "Customers",
      href: "/admin/customers",
      section: "commerce",
      parentCode: null,
      kind: "workspace",
    } as unknown as typeof overview;

    expect(
      adminNavigationItemsForScope([staleItem], {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      }),
    ).toEqual([]);
  });
});
