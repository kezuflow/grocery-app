// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaleTargetsPicker } from "./sale-targets-picker";

vi.mock("@/app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: {
      phase: "ready",
      context: { capabilities: ["promotions.manage"] },
      scopes: [
        {
          kind: "location",
          marketId: "market-1",
          marketCode: "CEBU",
          locationId: "loc-1",
          locationCode: "CEBU1",
          locationName: "Cebu City Store",
          currency: "PHP",
        },
      ],
    },
  }),
}));

const productDetail = {
  productId: "product-abiu",
  slug: "abiu",
  name: "Abiu",
  categoryCode: "produce",
  status: "active",
  version: 1,
  categoryId: "cat-1",
  categoryName: "Produce",
  description: null,
  customerDetails: [],
  media: [],
  inventoryPool: {
    inventoryPoolId: "pool-1",
    baseUnitId: "unit-piece",
    baseUnitCode: "PIECE",
    baseUnitSymbol: "pc",
    position: null,
  },
  scope: {
    kind: "LOCATION",
    marketId: "market-1",
    marketName: "Cebu",
    locationId: "loc-1",
    locationName: "Cebu City Store",
    currency: "PHP",
  },
  allowedActions: ["UPDATE"],
  recentAudit: [],
  skus: [
    {
      skuId: "sku-piece",
      code: "ABIU_PC",
      name: "1 piece",
      merchandisingLabel: null,
      unitSymbol: "pc",
      sellQuantity: 1,
      consumptionBaseQuantity: 1,
      estimatedShippingWeightGrams: null,
      status: "active",
      sortOrder: 0,
      version: 1,
      priceMinor: 12000,
      currency: "PHP",
      priceVersion: 1,
      availability: "AVAILABLE",
      availabilityVersion: 1,
      availableBase: 98,
    },
    {
      skuId: "sku-pack",
      code: "ABIU_PK",
      name: "Pack of 5",
      merchandisingLabel: null,
      unitSymbol: "pack",
      sellQuantity: 5,
      consumptionBaseQuantity: 5,
      estimatedShippingWeightGrams: null,
      status: "active",
      sortOrder: 1,
      version: 1,
      priceMinor: 55000,
      currency: "PHP",
      priceVersion: 1,
      availability: "UNAVAILABLE",
      availabilityVersion: 1,
      availableBase: 0,
    },
  ],
};

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

function ok(value: unknown): Response {
  return Response.json({ ok: true, requestId: "test", value });
}

function setText(control: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/catalog/products/product-abiu"))
      return Promise.resolve(ok(productDetail));
    if (url.startsWith("/api/admin/catalog/products"))
      return Promise.resolve(
        ok({
          items: [
            {
              productId: "product-abiu",
              slug: "abiu",
              categoryCode: "produce",
              name: "Abiu",
              status: "active",
              skuCount: 2,
              version: 1,
            },
          ],
          nextCursor: null,
        }),
      );
    throw new Error(`Unexpected fetch ${url}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Real timers keep async act settleable; the debounce is only 300ms. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function flush(): Promise<void> {
  await act(async () => {
    await sleep(20);
  });
}

async function settleDebounce(): Promise<void> {
  await act(async () => {
    await sleep(350);
  });
}

async function renderPicker(properties: Partial<Parameters<typeof SaleTargetsPicker>[0]> = {}) {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <SaleTargetsPicker
        value={[]}
        onChange={onChange}
        disabled={false}
        preview={{ mode: "PERCENT", value: 20 }}
        activeOverlaps={new Set()}
        {...properties}
      />,
    ),
  );
  await flush();
  return onChange;
}

function clickButton(match: (text: string) => boolean): void {
  const button = [...host.querySelectorAll("button")].find((button) =>
    match(button.textContent ?? ""),
  );
  if (!button) throw new Error("Matching button was not rendered");
  act(() => button.click());
}

it("searches live after debounce, loads location-scoped options and previews the sale price", async () => {
  await renderPicker();
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search sale products"]',
  )!;
  setText(search, "abiu");
  await settleDebounce();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/catalog/products?scopeKind=GLOBAL&status=active&limit=10&query=abiu",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );

  clickButton((text) => text.includes("Abiu"));
  await flush();
  const detailUrl = fetchMock.mock.calls
    .map(([input]) => String(input))
    .find((url) => url.includes("scopeKind=LOCATION&marketId=market-1&locationId=loc-1"));
  if (!detailUrl) throw new Error("Location-scoped option fetch was not issued");
  expect(detailUrl).toContain("/api/admin/catalog/products/product-abiu");
  expect(host.textContent).toContain("1 piece");
  expect(host.textContent).toContain("₱120.00");

  clickButton((text) => text.includes("1 piece"));
  expect(host.textContent).toContain("₱96.00");
  expect(host.textContent).toContain("saves ₱24.00 per unit");
  expect(host.textContent).toContain("98 sellable pieces");
});

it("adds a whole-stock target by default and a fixed pool only for positive whole pieces", async () => {
  const onChange = await renderPicker();
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search sale products"]',
  )!;
  setText(search, "abiu");
  await settleDebounce();
  clickButton((text) => text.includes("Abiu"));
  await flush();
  const pickOption = () => {
    clickButton((text) => text.includes("1 piece"));
  };
  pickOption();

  const add = () => {
    clickButton((text) => text === "Add to sale");
  };
  add();
  expect(onChange).toHaveBeenCalledWith([
    expect.objectContaining({ skuId: "sku-piece", locationId: "loc-1", quantityLimit: null }),
  ]);

  pickOption();
  const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const fixedRadio = radios.find((radio) => radio.parentElement?.textContent?.includes("Fixed"))!;
  act(() => fixedRadio.click());
  const poolInput = host.querySelector<HTMLInputElement>('input[aria-label="Fixed pool pieces"]')!;
  setText(poolInput, "2.5");
  add();
  expect(host.textContent).toContain("positive whole number of pieces");
  setText(poolInput, "25");
  add();
  expect(onChange).toHaveBeenLastCalledWith([
    expect.objectContaining({ skuId: "sku-piece", locationId: "loc-1", quantityLimit: 25 }),
  ]);
});

it("warns when another active sale already covers the option at the location", async () => {
  await renderPicker({ activeOverlaps: new Set(["sku-piece:loc-1"]) });
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search sale products"]',
  )!;
  setText(search, "abiu");
  await settleDebounce();
  clickButton((text) => text.includes("Abiu"));
  await flush();
  clickButton((text) => text.includes("1 piece"));
  expect(host.textContent).toContain("Another active sale already covers this option");
});
