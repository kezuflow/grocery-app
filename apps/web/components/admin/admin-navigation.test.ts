import { describe, expect, it } from "vitest";
import {
  adminNavigationFromContext,
  adminNavigationItemsForScope,
  commandPaletteEntries,
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
  it("searches Settings children without offering the redirect-only root", () => {
    const items = adminNavigationFromContext([
      {
        code: "settings",
        label: "Settings",
        href: "/admin/settings",
        section: "settings",
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace",
      },
      {
        code: "settings-delivery-cycles",
        label: "Scheduled cycles",
        href: "/admin/settings/scheduled-cycles",
        section: "settings",
        scopeKinds: globalScope,
        parentCode: "settings",
        kind: "destination",
      },
    ]);
    expect(
      commandPaletteEntries(groupAdminNavigation(items)[0]!).map((entry) => entry.code),
    ).toEqual(["settings-delivery-cycles"]);
  });

  it("shows Banners as a separate Core-authorized workspace", () => {
    const items = adminNavigationFromContext([
      {
        ...overview,
        code: "banners",
        label: "Banners",
        href: "/admin/banners",
        section: "commerce",
        scopeKinds: globalScope,
      },
      {
        ...overview,
        code: "promotions",
        label: "Promotion Codes",
        href: "/admin/promotions",
        section: "commerce",
        scopeKinds: globalScope,
      },
    ]);
    expect(items.map((item) => item.code)).toEqual(["banners", "promotions"]);
    expect(mostSpecificActiveNavigation(items, "/admin/banners")?.code).toBe("banners");
    expect(
      adminNavigationItemsForScope(items, {
        kind: "LOCATION",
        marketId: "market-a",
        locationId: "location-a",
      }),
    ).toEqual([]);
  });
  it("preserves the navigation order supplied by Core", () => {
    expect(adminNavigationFromContext([audit, overview]).map((item) => item.code)).toEqual([
      "audit",
      "overview",
    ]);
  });

  it("groups Shopify sections in Core order without dropping independently authorized leaves", () => {
    const items = adminNavigationFromContext([
      { ...overview, label: "Home", section: "home" },
      {
        ...overview,
        code: "procurement",
        label: "Delivery weeks",
        href: "/admin/procurement",
        section: "orders",
      },
      {
        ...overview,
        code: "receiving",
        label: "Receiving",
        href: "/admin/receiving",
        section: "products",
        scopeKinds: ["LOCATION"],
      },
      { ...audit, section: "settings" },
    ]);
    const groups = groupAdminNavigation(items);
    expect(groups.map((group) => group.code)).toEqual(["home", "orders", "products", "settings"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.code))).toEqual([
      "overview",
      "procurement",
      "receiving",
      "audit",
    ]);
    expect(mostSpecificActiveNavigation(items, "/admin/receiving")?.code).toBe("receiving");
  });

  it("keeps Core-provided destinations even when Web has no dedicated icon", () => {
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
    expect(items.map((item) => item.code)).toEqual(["not-a-workspace", "orders"]);
    expect(items[0]).toMatchObject({ label: "Mystery", href: "/admin/mystery" });
    expect(items[0].icon).toBeTruthy();
  });

  it("returns an empty navigation for an empty Core payload", () => {
    expect(adminNavigationFromContext([])).toEqual([]);
  });

  it("uses the section icon for an unfamiliar Core-provided workspace", () => {
    const items = adminNavigationFromContext([
      {
        code: "future-finance-workspace",
        label: "Future finance workspace",
        href: "/admin/future-finance-workspace",
        section: "finance",
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace",
      },
    ]);
    expect(items[0]).toMatchObject({
      code: "future-finance-workspace",
      label: "Future finance workspace",
      href: "/admin/future-finance-workspace",
    });
    expect(items[0]?.icon).toBeTruthy();
  });

  it("keeps the Core-authorized Locations workspace visible in Global and location scopes", () => {
    const locations = {
      code: "locations",
      label: "Locations",
      href: "/admin/locations",
      section: "administration" as const,
      scopeKinds: ["GLOBAL", "LOCATION"] as const,
      parentCode: null,
      kind: "workspace" as const,
    };
    const items = adminNavigationFromContext([
      locations,
      { ...locations, code: "locations-list", parentCode: "locations", kind: "destination" },
      {
        ...locations,
        code: "locations-service-areas",
        label: "Service Areas",
        href: "/admin/locations/service-areas",
        parentCode: "locations",
        kind: "destination",
      },
    ]);

    expect(items[0]).toMatchObject({
      code: "locations",
      label: "Locations",
      href: "/admin/locations",
    });
    expect(items[0]?.icon).toBeTruthy();
    expect(adminNavigationItemsForScope(items, { kind: "GLOBAL" })).toHaveLength(3);
    expect(
      adminNavigationItemsForScope(items, {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      }),
    ).toHaveLength(3);
    expect(groupAdminNavigation(items)[0]?.items[0]?.children.map((child) => child.label)).toEqual([
      "Locations",
      "Service Areas",
    ]);
    for (const path of ["/admin/locations", "/admin/locations/location-cebu-central/fulfillment"]) {
      expect(mostSpecificActiveNavigation(items, path)).toEqual({
        code: "locations-list",
        parentCode: "locations",
      });
    }
    expect(mostSpecificActiveNavigation(items, "/admin/locations/service-areas")).toEqual({
      code: "locations-service-areas",
      parentCode: "locations",
    });
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

  it("shows only Core-declared location navigation for Central Cebu", () => {
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
        label: "Promotion Codes",
        href: "/admin/promotions",
        section: "commerce" as const,
        scopeKinds: globalScope,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "location-products",
        label: "Products",
        href: "/admin/catalog/products",
        section: "operations" as const,
        scopeKinds: ["LOCATION"] as const,
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
      {
        code: "fulfillment",
        label: "Fulfillment",
        href: "/admin/fulfillment",
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
    ).toEqual(["overview", "orders", "location-products", "inventory", "fulfillment", "audit"]);
  });

  it("shows Procurement, Receiving and Transfers according to Core scope metadata", () => {
    const items = [
      overview,
      {
        code: "transfers",
        label: "Warehouse transfers",
        href: "/admin/transfers",
        section: "operations" as const,
        scopeKinds: ["GLOBAL", "LOCATION"] as const,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "procurement",
        label: "Procurement",
        href: "/admin/procurement",
        section: "operations" as const,
        scopeKinds: ["GLOBAL", "LOCATION"] as const,
        parentCode: null,
        kind: "workspace" as const,
      },
      {
        code: "receiving",
        label: "Receiving",
        href: "/admin/receiving",
        section: "operations" as const,
        scopeKinds: ["LOCATION"] as const,
        parentCode: null,
        kind: "workspace" as const,
      },
    ];
    const global = adminNavigationFromContext(
      adminNavigationItemsForScope(items, { kind: "GLOBAL" }),
    );
    expect(global.map((item) => item.code)).toEqual(["overview", "transfers", "procurement"]);
    const centralCebu = adminNavigationFromContext(
      adminNavigationItemsForScope(items, {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      }),
    );
    expect(groupAdminNavigation(centralCebu)[1]?.items.map((item) => item.code)).toEqual([
      "transfers",
      "procurement",
      "receiving",
    ]);
    expect(mostSpecificActiveNavigation(centralCebu, "/admin/receiving")?.code).toBe("receiving");
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

  it("hides location-only Inventory and Fulfillment when Global is selected", () => {
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
          {
            code: "fulfillment",
            label: "Fulfillment",
            href: "/admin/fulfillment",
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
