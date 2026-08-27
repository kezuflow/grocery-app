import { describe, expect, it } from "vitest";
import { adminNavigationFromContext } from "./admin-navigation";

describe("admin navigation mapping", () => {
  it("renders only Core-provided navigation in canonical order", () => {
    expect(
      adminNavigationFromContext([
        { code: "audit", label: "Audit", href: "/admin/audit" },
        { code: "overview", label: "Overview", href: "/admin" },
      ]).map((item) => item.code),
    ).toEqual(["overview", "audit"]);
  });

  it("drops unknown codes and keeps Core labels and hrefs verbatim", () => {
    const items = adminNavigationFromContext([
      { code: "not-a-workspace", label: "Mystery", href: "/admin/mystery" },
      { code: "orders", label: "Orders", href: "/admin/orders" },
    ]);
    expect(items.map((item) => item.code)).toEqual(["orders"]);
    expect(items[0]).toMatchObject({ label: "Orders", href: "/admin/orders" });
    expect(items[0].icon).toBeTruthy();
  });

  it("returns an empty navigation for an empty Core payload", () => {
    expect(adminNavigationFromContext([])).toEqual([]);
  });
});
