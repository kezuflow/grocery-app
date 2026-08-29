import { describe, expect, it } from "vitest";
import {
  adminNavigationFromContext,
  groupAdminNavigation,
  mostSpecificActiveNavigation,
} from "./admin-navigation";

const overview = {
  code: "overview",
  label: "Overview",
  href: "/admin",
  section: "overview" as const,
  parentCode: null,
  kind: "workspace" as const,
};

const audit = {
  code: "audit",
  label: "Audit log",
  href: "/admin/audit",
  section: "administration" as const,
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
        parentCode: null,
        kind: "workspace",
      },
      {
        code: "orders",
        label: "Orders",
        href: "/admin/orders",
        section: "commerce",
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

  it("groups only Core-provided entries under their canonical sections and parents", () => {
    const groups = groupAdminNavigation(
      adminNavigationFromContext([
        overview,
        {
          code: "products",
          label: "Products",
          href: "/admin/catalog/products",
          section: "commerce",
          parentCode: null,
          kind: "workspace",
        },
        {
          code: "products-list",
          label: "Product list",
          href: "/admin/catalog/products",
          section: "commerce",
          parentCode: "products",
          kind: "destination",
        },
      ]),
    );

    expect(groups.map((group) => group.code)).toEqual(["overview", "commerce"]);
    expect(groups[1]?.items[0]?.children.map((child) => child.code)).toEqual(["products-list"]);
  });

  it("selects the most-specific route and reports its parent", () => {
    const items = adminNavigationFromContext([
      {
        code: "products",
        label: "Products",
        href: "/admin/catalog/products",
        section: "commerce",
        parentCode: null,
        kind: "workspace",
      },
      {
        code: "products-create",
        label: "Add product",
        href: "/admin/catalog/products/new",
        section: "commerce",
        parentCode: "products",
        kind: "destination",
      },
    ]);

    expect(mostSpecificActiveNavigation(items, "/admin/catalog/products/new")).toEqual({
      code: "products-create",
      parentCode: "products",
    });
  });
});
