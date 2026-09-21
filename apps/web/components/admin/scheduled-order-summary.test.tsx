// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduledOrderSummary, formatScheduledQuantity } from "./scheduled-order-summary";

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const totals = {
  paidOrderCount: 3,
  productCount: 3,
  sellingOptionCount: 3,
  destinationCount: 2,
};

const items = [
  {
    skuId: "abiu",
    inventoryPoolId: "abiu-pool",
    productName: "Abiu",
    variantName: "1 piece",
    unitName: "PIECE",
    baseUnit: "PIECE" as const,
    paidOrderCount: 1,
    soldUnitCount: 10,
    totalQuantityBase: 10,
    destinationCount: 1,
  },
  {
    skuId: "carrot",
    inventoryPoolId: "carrot-pool",
    productName: "Carrots",
    variantName: "1 kg",
    unitName: "GRAM",
    baseUnit: "GRAM" as const,
    paidOrderCount: 2,
    soldUnitCount: 12,
    totalQuantityBase: 12000,
    destinationCount: 2,
  },
  {
    skuId: "cucumber",
    inventoryPoolId: "cucumber-pool",
    productName: "Cucumber",
    variantName: "1 kg",
    unitName: "GRAM",
    baseUnit: "GRAM" as const,
    paidOrderCount: 1,
    soldUnitCount: 30,
    totalQuantityBase: 30000,
    destinationCount: 1,
  },
];

describe("ScheduledOrderSummary", () => {
  it("renders exact human-readable quantities, totals, and Global destinations", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ScheduledOrderSummary items={items} totals={totals} global />));
    expect(container.querySelector('table[aria-label="Paid ordered products"]')).not.toBeNull();
    expect(container.textContent).toContain("Abiu");
    expect(container.textContent).toContain("10 pcs");
    expect(container.textContent).toContain("12 kg");
    expect(container.textContent).toContain("30 kg");
    expect(container.textContent).toContain("Selling options3");
    expect(container.textContent).toContain("Destinations2");
    expect(container.textContent).toContain("do not subtract physical stock");
  });

  it("renders the clear empty state and preserves fractional kilograms exactly", () => {
    expect(formatScheduledQuantity(1250, "GRAM")).toBe("1.25 kg");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <ScheduledOrderSummary
          items={[]}
          totals={{
            paidOrderCount: 0,
            productCount: 0,
            sellingOptionCount: 0,
            destinationCount: 0,
          }}
          global={false}
        />,
      ),
    );
    expect(container.textContent).toContain("No paid products are recorded for this cycle.");
  });
});
