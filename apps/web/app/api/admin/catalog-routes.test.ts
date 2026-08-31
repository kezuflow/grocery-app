import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listAdminCategories: vi.fn(),
  createAdminCategory: vi.fn(),
  getAdminCategory: vi.fn(),
  updateAdminCategory: vi.fn(),
  setAdminCategoryStatus: vi.fn(),
  listAdminUnits: vi.fn(),
  createAdminUnit: vi.fn(),
  listAdminProducts: vi.fn(),
  createAdminProduct: vi.fn(),
  getAdminProduct: vi.fn(),
  updateAdminProduct: vi.fn(),
  setAdminProductStatus: vi.fn(),
  uploadAdminProductMedia: vi.fn(),
  updateAdminProductMedia: vi.fn(),
  removeAdminProductMedia: vi.fn(),
  getAdminProductMediaContent: vi.fn(),
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
import {
  GET as getCategory,
  PATCH as updateCategory,
} from "./catalog/categories/[category-id]/route";
import { POST as categoryStatus } from "./catalog/categories/[category-id]/status/route";
import { GET as listUnits, POST as createUnit } from "./catalog/units/route";
import { GET as listProducts, POST as createProduct } from "./catalog/products/route";
import { GET as getProduct, PATCH as updateProduct } from "./catalog/products/[product-id]/route";
import { POST as productStatus } from "./catalog/products/[product-id]/status/route";
import { POST as uploadProductMedia } from "./catalog/products/[product-id]/media/route";
import {
  DELETE as removeProductMedia,
  PATCH as updateProductMedia,
} from "./catalog/products/[product-id]/media/[media-id]/route";
import { GET as getProductMediaContent } from "./catalog/products/[product-id]/media/[media-id]/content/route";
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
const categoryParams = { params: Promise.resolve({ "category-id": "category-1" }) };
const productParams = { params: Promise.resolve({ "product-id": "prod-1" }) };
const mediaParams = {
  params: Promise.resolve({ "product-id": "prod-1", "media-id": "media-1" }),
};
const skuParams = { params: Promise.resolve({ "sku-id": "sku-1" }) };
const poolParams = { params: Promise.resolve({ "inventory-pool-id": "pool-1" }) };

function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "idem-1", ...COOKIE },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

describe("catalog and inventory BFF routes", () => {
  it("delegates category and unit reads/creates", async () => {
    coreMocks.listAdminCategories.mockResolvedValue({
      ok: true,
      value: { items: [] },
      requestId: "r",
    });
    coreMocks.createAdminCategory.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.listAdminUnits.mockResolvedValue({ ok: true, value: [], requestId: "r" });
    coreMocks.createAdminUnit.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listCategories(
      new Request("https://x/categories?query=roots&status=active&limit=25&cursor=next", {
        headers: COOKIE,
      }),
    );
    await createCategory(
      jsonRequest("https://x/categories", { code: "T_1", name: "T", slug: "t-1" }),
    );
    await listUnits(new Request("https://x/units", { headers: COOKIE }));
    await createUnit(
      jsonRequest("https://x/units", {
        code: "U_1",
        displayName: "Unit",
        dimension: "MASS",
        canonicalBaseCode: "GRAM",
        conversionNumerator: 1,
        conversionDenominator: 1,
      }),
    );

    expect(coreMocks.createAdminCategory.mock.calls[0][0]).toMatchObject({
      code: "T_1",
      parentCategoryId: null,
      idempotencyKey: "idem-1",
    });
    expect(coreMocks.listAdminCategories.mock.calls[0][0]).toMatchObject({
      query: "roots",
      status: "active",
      limit: 25,
      cursor: "next",
    });
    expect(coreMocks.createAdminUnit.mock.calls[0][0]).toMatchObject({ dimension: "MASS" });
  });

  it("validates and delegates category detail, update, and status commands", async () => {
    coreMocks.getAdminCategory.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.updateAdminCategory.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminCategoryStatus.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await getCategory(
      new Request("https://x/categories/category-1", { headers: COOKIE }),
      categoryParams,
    );
    await updateCategory(
      jsonRequest(
        "https://x/categories/category-1",
        {
          name: "Roots",
          slug: "roots",
          parentCategoryId: null,
          iconAssetKey: "roots.svg",
          sortOrder: 4,
          expectedVersion: 2,
        },
        "PATCH",
      ),
      categoryParams,
    );
    await categoryStatus(
      jsonRequest("https://x/categories/category-1/status", {
        status: "inactive",
        reason: "Seasonal pause",
        expectedVersion: 3,
      }),
      categoryParams,
    );

    expect(coreMocks.updateAdminCategory.mock.calls[0][0]).toMatchObject({
      categoryId: "category-1",
      parentCategoryId: null,
      expectedVersion: 2,
      idempotencyKey: "idem-1",
    });
    expect(coreMocks.setAdminCategoryStatus.mock.calls[0][0]).toMatchObject({
      categoryId: "category-1",
      reason: "Seasonal pause",
      expectedVersion: 3,
    });
  });

  it("delegates product list/detail/status", async () => {
    coreMocks.listAdminProducts.mockResolvedValue({
      ok: true,
      value: { items: [] },
      requestId: "r",
    });
    coreMocks.getAdminProduct.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminProductStatus.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listProducts(
      new Request(
        "https://x/products?marketId=market-2&locationId=location-2&query=onion&status=inactive&limit=25&cursor=next",
        { headers: COOKIE },
      ),
    );
    await getProduct(
      new Request("https://x/products/p1?marketId=market-2&locationId=location-2", {
        headers: COOKIE,
      }),
      productParams,
    );
    await productStatus(
      jsonRequest("https://x/products/p1/status", {
        status: "inactive",
        reason: "pause",
        expectedVersion: 1,
      }),
      productParams,
    );

    expect(coreMocks.listAdminProducts.mock.calls[0][0]).toMatchObject({
      query: "onion",
      status: "inactive",
      limit: 25,
      cursor: "next",
      marketId: "market-2",
      locationId: "location-2",
    });
    expect(coreMocks.setAdminProductStatus.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      status: "inactive",
    });
    expect(coreMocks.getAdminProduct.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      marketId: "market-2",
      locationId: "location-2",
    });
  });

  it("requires explicit Product-list pricing context", async () => {
    const response = await listProducts(new Request("https://x/products", { headers: COOKIE }));
    expect(response.status).toBe(400);
    expect(coreMocks.listAdminProducts).not.toHaveBeenCalled();
  });

  it("whitelists and delegates Product create and update fields", async () => {
    coreMocks.createAdminProduct.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.updateAdminProduct.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    const createBody = {
      categoryId: "category-1",
      slug: "red-onion",
      name: "Red onion",
      description: null,
      customerDetails: [{ label: "Storage", value: "Keep cool", sortOrder: 1 }],
      inventoryBaseUnitId: "unit-gram",
      status: "inactive",
    };
    await createProduct(jsonRequest("https://x/products", createBody));
    await updateProduct(
      jsonRequest(
        "https://x/products/prod-1",
        { ...createBody, expectedVersion: 2, arbitraryDatabaseField: "not allowed" },
        "PATCH",
      ),
      productParams,
    );
    expect(coreMocks.createAdminProduct.mock.calls[0][0]).toMatchObject({
      categoryId: "category-1",
      inventoryBaseUnitId: "unit-gram",
      idempotencyKey: "idem-1",
    });
    expect(coreMocks.createAdminProduct.mock.calls[0][0]).not.toHaveProperty("status");
    expect(coreMocks.updateAdminProduct.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      expectedVersion: 2,
    });
    expect(coreMocks.updateAdminProduct.mock.calls[0][0]).not.toHaveProperty(
      "arbitraryDatabaseField",
    );
  });

  it("parses bounded multipart Product media and delegates only canonical fields", async () => {
    coreMocks.uploadAdminProductMedia.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.updateAdminProductMedia.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.removeAdminProductMedia.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "onion.jpg", {
        type: "image/jpeg",
      }),
    );
    form.set("altText", "Red onion");
    form.set("isPrimary", "true");
    form.set("sortOrder", "2");
    form.set("expectedProductVersion", "3");
    form.set("objectKey", "caller/controlled/key");
    await uploadProductMedia(
      new Request("https://x/products/prod-1/media", {
        method: "POST",
        headers: { "idempotency-key": "media-upload-1", ...COOKIE },
        body: form,
      }),
      productParams,
    );
    expect(coreMocks.uploadAdminProductMedia.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      mimeType: "image/jpeg",
      altText: "Red onion",
      isPrimary: true,
      sortOrder: 2,
      expectedProductVersion: 3,
      idempotencyKey: "media-upload-1",
    });
    expect(coreMocks.uploadAdminProductMedia.mock.calls[0][0].bytes).toBeInstanceOf(ArrayBuffer);
    expect(coreMocks.uploadAdminProductMedia.mock.calls[0][0]).not.toHaveProperty("objectKey");

    await updateProductMedia(
      jsonRequest(
        "https://x/products/prod-1/media/media-1",
        { altText: "Updated onion", isPrimary: false, sortOrder: 4, expectedProductVersion: 4 },
        "PATCH",
      ),
      mediaParams,
    );
    expect(coreMocks.updateAdminProductMedia.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      mediaId: "media-1",
      altText: "Updated onion",
      expectedProductVersion: 4,
    });

    await removeProductMedia(
      jsonRequest(
        "https://x/products/prod-1/media/media-1",
        { expectedProductVersion: 5, objectKey: "ignored" },
        "DELETE",
      ),
      mediaParams,
    );
    expect(coreMocks.removeAdminProductMedia.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      mediaId: "media-1",
      expectedProductVersion: 5,
    });
    expect(coreMocks.removeAdminProductMedia.mock.calls[0][0]).not.toHaveProperty("objectKey");
  });

  it("serves authorized Product media bytes with private conditional caching", async () => {
    coreMocks.getAdminProductMediaContent.mockResolvedValue({
      ok: true,
      value: {
        bytes: new Uint8Array([1, 2, 3]).buffer,
        mimeType: "image/webp",
        etag: '"media-etag"',
        version: 4,
      },
      requestId: "media-content",
    });
    const response = await getProductMediaContent(
      new Request("https://x/products/prod-1/media/media-1/content", { headers: COOKIE }),
      mediaParams,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("etag")).toBe('"media-etag"');
    expect(response.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(coreMocks.getAdminProductMediaContent.mock.calls[0][0]).toMatchObject({
      productId: "prod-1",
      mediaId: "media-1",
    });

    const notModified = await getProductMediaContent(
      new Request("https://x/products/prod-1/media/media-1/content", {
        headers: { ...COOKIE, "if-none-match": '"media-etag"' },
      }),
      mediaParams,
    );
    expect(notModified.status).toBe(304);
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
        sellQuantity: 250,
        consumptionBaseQuantity: 250,
      }),
    );
    await updateSku(
      jsonRequest(
        "https://x/skus/sku-1",
        { merchandisingLabel: "Pack", expectedVersion: 1 },
        "PATCH",
      ),
      skuParams,
    );
    await setAvailability(
      jsonRequest(
        "https://x/skus/sku-1/availability",
        {
          locationId: "location-cebu-central",
          availabilityStatus: "AVAILABLE",
          sourcingMode: "STOCKED",
          expectedVersion: 0,
        },
        "PUT",
      ),
      skuParams,
    );
    await setPrice(
      jsonRequest("https://x/skus/sku-1/price", {
        marketId: "market-metro-cebu",
        locationId: null,
        currency: "PHP",
        amountMinor: 2500,
        validFrom: 1000,
        expectedVersion: 2,
      }),
      skuParams,
    );

    expect(coreMocks.setAdminSkuAvailability.mock.calls[0][0]).toMatchObject({
      skuId: "sku-1",
      sourcingMode: "STOCKED",
    });
    expect(coreMocks.setAdminSkuPrice.mock.calls[0][0]).toMatchObject({
      locationId: null,
      validFrom: 1000,
      expectedVersion: 2,
    });
    expect(coreMocks.setAdminSkuPrice.mock.calls[0][0]).toMatchObject({ amountMinor: 2500 });
  });

  it("delegates inventory list and ledger with location", async () => {
    coreMocks.listAdminInventory.mockResolvedValue({
      ok: true,
      value: { items: [] },
      requestId: "r",
    });
    coreMocks.getAdminInventoryLedger.mockResolvedValue({
      ok: true,
      value: { items: [] },
      requestId: "r",
    });

    await listInventory(
      new Request("https://x/inventory?locationId=location-cebu-central", { headers: COOKIE }),
    );
    await getLedger(
      new Request("https://x/inventory/pool-1/ledger?locationId=location-cebu-central", {
        headers: COOKIE,
      }),
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
