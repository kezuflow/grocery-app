// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import InventoryPage from "@/app/admin/inventory/page";
vi.mock("@/components/admin/use-admin-location", () => ({
  useAdminLocation: () => ({ locationId: "cebu", label: "Cebu" }),
}));
vi.mock("@/components/admin/admin-shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ListPageSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("@/components/admin/admin-controls", async () => {
  const actual = await vi.importActual<typeof import("@/components/admin/admin-controls")>(
    "@/components/admin/admin-controls",
  );
  return {
    ...actual,
    AdminConfirmationDialog: ({
      open,
      onConfirm,
    }: {
      open: boolean;
      onConfirm: (reason: string) => void;
    }) =>
      open ? (
        <button onClick={() => onConfirm("Inspected count")}>Confirm test stock</button>
      ) : null,
  };
});
const fetchMock = vi.fn<typeof fetch>();
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("retains exact stock details after an unknown result and shows Core's hold-adjusted availability", async () => {
  const writes: RequestInit[] = [];
  const response = (value: unknown) =>
    new Response(JSON.stringify({ ok: true, value, requestId: "test" }), {
      headers: { "content-type": "application/json" },
    });
  fetchMock.mockImplementation(async (url, options) => {
    if (options?.method === "POST") {
      writes.push(options);
      if (writes.length === 1) throw new Error("lost response");
      return response({
        locationId: "cebu",
        inventoryPoolId: "pool",
        onHandBase: 15,
        reservedBase: 0,
        version: 2,
        ledgerEntryId: "entry",
      });
    }
    if (String(url).includes("/ledger")) return response({ items: [], nextCursor: null });
    return response({
      items: [
        {
          locationId: "cebu",
          inventoryPoolId: "pool",
          productId: "product",
          productName: "Red onion",
          baseUnitSymbol: "g",
          onHandBase: 10,
          reservedBase: 0,
          heldBase: 2,
          availableBase: 8,
          version: 1,
        },
      ],
      nextCursor: null,
    });
  });
  await act(async () => root.render(<InventoryPage />));
  expect(container.textContent).toContain("2 held");
  expect(container.textContent).toContain("8 g");
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Stock quantity for Red onion"]',
  );
  if (!input) throw new Error("Quantity input missing");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing input setter");
    setter.call(input, "5");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    );
    if (!button) throw new Error(`${label} missing`);
    await act(async () => button.click());
  }
  await click("Add stock");
  await click("Confirm test stock");
  expect(container.textContent).toContain("stock result is unknown");
  expect(input.disabled).toBe(true);
  expect(
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Add stock")
      ?.disabled,
  ).toBe(true);
  await click("Retry saved adjustment");
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toBe(writes[0].body);
  expect(writes[1].headers).toEqual(writes[0].headers);
  expect(JSON.parse(String(writes[0].body))).toEqual({
    locationId: "cebu",
    inventoryPoolId: "pool",
    operation: "ADD",
    quantityBase: 5,
    reason: "Inspected count",
    expectedVersion: 1,
  });
  expect(container.textContent).toContain("Stock added");
});
