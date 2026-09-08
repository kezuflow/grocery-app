// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminCatalogSkuSummary } from "@freshmarkets/contracts";
import { SkuVariantEditor } from "./sku-variant-editor";

const sku: AdminCatalogSkuSummary = {
  skuId: "sku-1",
  code: "BANANA",
  name: "Bunch",
  merchandisingLabel: "Six pieces",
  unitSymbol: "pc",
  sellQuantity: 1,
  consumptionBaseQuantity: 6,
  estimatedShippingWeightGrams: 700,
  status: "active",
  sortOrder: 1,
  version: 3,
  priceMinor: null,
  currency: null,
  priceVersion: null,
  availability: null,
  availabilityVersion: null,
};
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
const onSaved = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  onSaved.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function input(label: string) {
  const field = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!field) throw new Error(`Missing ${label}`);
  return field;
}
async function fill(label: string, value: string) {
  await act(() => {
    const field = input(label);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing input setter");
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open() {
  await act(() =>
    root.render(<SkuVariantEditor sku={sku} baseUnitCode="PIECE" onSaved={onSaved} />),
  );
  await act(() => container.querySelector("button")?.click());
}
async function save() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing variant form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("keeps an unconfirmed complete edit frozen and reuses it from Save", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("lost response"))
    .mockRejectedValueOnce(new Error("lost retry"));
  await open();
  await fill("Variant display name", "Family bunch");
  await fill("Variant merchandising label", "");
  await fill("Variant shipping weight", "850");
  await save();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(onSaved).not.toHaveBeenCalled();
  expect(document.querySelector("fieldset")?.disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try Save again");
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: true,
        value: {
          ...sku,
          name: "Family bunch",
          merchandisingLabel: null,
          estimatedShippingWeightGrams: 850,
          version: 4,
        },
        requestId: "saved",
      }),
    ),
  );
  await save();
  const requests = fetchMock.mock.calls.map((call) => call[1]);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
    name: "Family bunch",
    merchandisingLabel: null,
    estimatedShippingWeightGrams: 850,
    expectedVersion: 3,
  });
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("keeps a rejected edit open and editable without reporting success", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Variant changed. Reload the product and try again.",
          requestId: "conflict",
        },
      }),
    ),
  );
  await open();
  await save();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Variant changed");
  expect(document.querySelector("fieldset")?.disabled).toBe(false);
  expect(onSaved).not.toHaveBeenCalled();
});
