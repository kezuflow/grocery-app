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

const options = [
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
const items = options.map((option) => ({
  productId: option.skuId,
  productName: option.productName,
  paidOrderCount: option.paidOrderCount,
  destinationCount: option.destinationCount,
  quantities: [
    {
      inventoryPoolId: option.inventoryPoolId,
      baseUnit: option.baseUnit,
      totalQuantityBase: option.totalQuantityBase,
      sellingOptionNames: [option.variantName],
    },
  ],
  sellingOptions: [
    {
      ...option,
      destinations: [
        {
          locationId: "location-a",
          locationName: "Central Cebu",
          soldUnitCount: option.soldUnitCount,
          totalQuantityBase: option.totalQuantityBase,
        },
      ],
    },
  ],
}));

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

  it("shows sized pieces in purchasing totals and Global breakdowns instead of accounting grams", () => {
    const purchaseQuantity = { sizeLabel: "Small", unit: "PIECE" as const, quantity: 3 };
    const option = {
      ...items[1]!.sellingOptions[0]!,
      variantName: "Small",
      soldUnitCount: 3,
      totalQuantityBase: 1500,
      purchaseQuantity,
      destinations: [
        {
          locationId: "central",
          locationName: "Central Cebu",
          soldUnitCount: 3,
          totalQuantityBase: 1500,
          purchaseQuantity,
        },
      ],
    };
    const item = {
      ...items[1]!,
      productName: "Repolyo (Cabbage)",
      purchaseQuantities: [purchaseQuantity],
      sellingOptions: [option],
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ScheduledOrderSummary items={[item]} totals={totals} global />));
    const table = container.querySelector("table")!;
    expect(table.textContent).toContain("Small3 pcs");
    act(() => table.querySelector<HTMLButtonElement>("button")!.click());
    expect(table.textContent).toContain("Central Cebu");
    expect(table.textContent).not.toContain("1.5 kg");
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

  it("keeps breakdowns collapsed and exposes accessible selling-option and destination details", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ScheduledOrderSummary items={items} totals={totals} global />));
    const trigger = container.querySelector<HTMLButtonElement>(
      'table button[aria-label="Selling options for Carrots"]',
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector('table ul[aria-label="Selling options for Carrots"]'),
    ).toBeNull();
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const breakdown = container.querySelector(
      'table ul[aria-label="Selling options for Carrots"]',
    )!;
    expect(breakdown.textContent).toContain("1 kg");
    expect(breakdown.textContent).toContain("12 sold units");
    expect(breakdown.textContent).toContain("Central Cebu");
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
