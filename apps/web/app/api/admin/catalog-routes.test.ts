import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listAdminCategories: vi.fn(),
  createAdminCategory: vi.fn(),
  listAdminUnits: vi.fn(),
  createAdminUnit: vi.fn(),
  listAdminProducts: vi.fn(),
  getAdminProduct: vi.fn(),
  setAdminProductStatus: vi.fn(),
  createAdminSku: vi.fn(),
  updateAdminSku: vi.fn(),
  setAdminSkuAvailability: vi.fn(),
  setAdminSkuPrice: vi.fn(),
  listAdminInventory: vi.fn(),
  getAdminInventoryLedger: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { CORE: coreMocks },
}));

import { GET as listCategories, POST as createCategory } from "./catalog/categories/route";
import { GET as listUnits, POST as createUnit } from "./catalog/units/route";
import { GET as listProducts } from "./catalog/products/route";
import { GET as getProduct } from "./catalog/products/[product-id]/route";
import { POST as productStatus } from "./catalog/products/[product-id]/status/route";
import { POST as createSku } from "./catalog/skus/route";
import { PATCH as updateSku } from "./catalog/skus/[sku-id]/route";
import { PUT as setAvailability } from "./catalog/skus/[sku-id]/availability/route";
import { POST as setPrice } from "./catalog/skus/[sku-id]/price/route";
import { GET as listInventory } from "./inventory/route";
import { GET as getLedger } from "./inventory/[inventory-pool-id]/ledger/route";

beforeEach(() => {
  for (const mock of Object.values(coreMocks)) mock.mockReset();
});

const COOKIE = { cookie: "session=abc" };
const productParams = { params: Promise.resolve({ "product-id": "prod-1" }) };
const skuParams = { params: Promise.resolve({ "sku-id": "sku-1" }) };
const poolParams = { params: Promise.resolve({ "inventory-pool-id": "pool-1" }) };

function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "idem-1", ...COOKIE },
    body: JSON.stringify(body),
  });
}

describe("catalog and inventory BFF routes", () => {
  it("delegates category and unit reads/creates", async () => {
    coreMocks.listAdminCategories.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.createAdminCategory.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.listAdminUnits.mockResolvedValue({ ok: true, value: [], requestId: "r" });
    coreMocks.createAdminUnit.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listCategories(new Request("https://x/categories", { headers: COOKIE }));
    await createCategory(
      jsonRequest("https://x/categories", { code: "T_1", name: "T", slug: "t-1" }),
    );
    await listUnits(new Request("https://x/units", { headers: COOKIE }));
    await createUnit(
      jsonRequest("https://x/units", { code: "U_1", name: "U", dimension: "MASS", symbol: "u" }),
    );

    expect(coreMocks.createAdminCategory.mock.calls[0][0]).toMatchObject({ code: "T_1", idempotencyKey: "idem-1" });
    expect(coreMocks.createAdminUnit.mock.calls[0][0]).toMatchObject({ dimension: "MASS" });
  });

  it("delegates product list/detail/status", async () => {
    coreMocks.listAdminProducts.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.getAdminProduct.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminProductStatus.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listProducts(new Request("https://x/products?query=onion", { headers: COOKIE }));
    await getProduct(new Request("https://x/products/p1", { headers: COOKIE }), productParams);
    await productStatus(
      jsonRequest("https://x/products/p1/status", { status: "inactive", reason: "pause", expectedVersion: 1 }),
      productParams,
    );

    expect(coreMocks.listAdminProducts.mock.calls[0][0].query).toBe("onion");
    expect(coreMocks.setAdminProductStatus.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      status: "inactive",
    });
  });

  it("delegates sku create/update/availability/price", async () => {
    coreMocks.createAdminSku.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.updateAdminSku.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminSkuAvailability.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminSkuPrice.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await createSku(
      jsonRequest("https://x/skus", {
        productId: "p1",
        code: "S1",
        name: "250 g",
        sellableUnitId: "u1",
        consumptionBaseQuantity: 250,
      }),
    );
    await updateSku(
      jsonRequest("https://x/skus/sku-1", { merchandisingLabel: "Pack", expectedVersion: 1 }, "PATCH"),
      skuParams,
    );
    await setAvailability(
      jsonRequest("https://x/skus/sku-1/availability", {
        locationId: "location-cebu-central",
        availabilityStatus: "AVAILABLE",
        sourcingMode: "STOCKED",
        expectedVersion: 0,
      }, "PUT"),
      skuParams,
    );
    await setPrice(
      jsonRequest("https://x/skus/sku-1/price", {
        marketId: "market-metro-cebu",
        currency: "PHP",
        amountMinor: 2500,
      }),
      skuParams,
    );

    expect(coreMocks.setAdminSkuAvailability.mock.calls[0][0]).toMatchObject({
      skuId: "sku-1",
      sourcingMode: "STOCKED",
    });
    expect(coreMocks.setAdminSkuPrice.mock.calls[0][0]).toMatchObject({ amountMinor: 2500 });
  });

  it("delegates inventory list and ledger with location", async () => {
    coreMocks.listAdminInventory.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.getAdminInventoryLedger.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });

    await listInventory(
      new Request("https://x/inventory?locationId=location-cebu-central", { headers: COOKIE }),
    );
    await getLedger(
      new Request("https://x/inventory/pool-1/ledger?locationId=location-cebu-central", { headers: COOKIE }),
      poolParams,
    );

    expect(coreMocks.listAdminInventory.mock.calls[0][0].locationId).toBe("location-cebu-central");
    expect(coreMocks.getAdminInventoryLedger.mock.calls[0][0]).toMatchObject({
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-1",
    });
  });

  it("returns 400 for inventory list without a location", async () => {
    const response = await listInventory(new Request("https://x/inventory", { headers: COOKIE }));
    expect(response.status).toBe(400);
    expect(coreMocks.listAdminInventory).not.toHaveBeenCalled();
  });
});
