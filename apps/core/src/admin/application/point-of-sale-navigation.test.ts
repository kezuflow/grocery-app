import { describe, expect, it } from "vitest";
import { adminNavigationFor } from "./get-admin-context";

describe("Point of Sale navigation", () => {
  it("only advertises the preparation station to fulfillment readers at a location", () => {
    const pointOfSale = (capabilities: Parameters<typeof adminNavigationFor>[0]) =>
      adminNavigationFor(capabilities).find((item) => item.code === "point-of-sale");

    expect(pointOfSale([])).toBeUndefined();
    expect(pointOfSale(["orders.read"])).toBeUndefined();
    expect(pointOfSale(["fulfillment.manage"])).toBeUndefined();
    expect(pointOfSale(["fulfillment.read"])).toMatchObject({
      href: "/admin/point-of-sale",
      section: "sales_channels",
      scopeKinds: ["LOCATION"],
    });
  });
});
