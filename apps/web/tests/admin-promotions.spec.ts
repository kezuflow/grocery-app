import { expect, test } from "./admin-authenticated-fixture";
import type { Page } from "@playwright/test";

/**
 * Promotion Codes workspace flows against a provisioned local stack. Skips when
 * the app is unreachable. Authenticated journeys use the deterministic local
 * Staff fixture configured by Playwright.
 */
let stackUp = false;

const listedPromotion = {
  promotionId: "promotion-code-1",
  code: "READ10",
  name: "Needle code",
  description: "",
  status: "DRAFT",
  benefitType: "ORDER_FIXED_DISCOUNT",
  discountMinor: 1_000,
  percent: null,
  minimumMinor: 0,
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: null,
  globalUsageLimit: null,
  perCustomerUsageLimit: null,
  automatic: false,
  priority: 0,
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} as const;

const listedSale = {
  ...listedPromotion,
  promotionId: "promotion-sale-1",
  code: "SALE_LISTED",
  name: "Needle sale",
  automatic: true,
  productTargets: [
    {
      skuId: "sku-1",
      locationId: "location-1",
      quantityLimit: 10,
      remainingQuantity: 8,
      productName: "Mango",
      skuName: "1 kg",
      locationName: "Central Cebu",
    },
  ],
} as const;

async function mockMixedPromotionPage(page: Page, nextCursor: string | null = null) {
  const requests: URL[] = [];
  await page.route("**/api/admin/promotions?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const later = url.searchParams.get("cursor") === "promotion-page-2";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "promotion-list-fixture",
        value: {
          items: later
            ? [{ ...listedPromotion, promotionId: "promotion-code-2", name: "Later Needle code" }]
            : [listedPromotion, listedSale],
          nextCursor: later ? null : nextCursor,
        },
      }),
    });
  });
  return requests;
}

async function openPromotionEditor(page: Page, type: string) {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.getByRole("button", { name: "Create promo code", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Select promotion type" });
  await expect(chooser).toBeVisible();
  if (process.env.SAUI_CAPTURE_DISCOUNTS_EDITOR === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/promotion-chooser-1440.png",
      animations: "disabled",
    });
  }
  await chooser.getByRole("button", { name: new RegExp(`^${type}`) }).click();
  await expect(chooser).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Create promo code" })).toBeVisible();
}

async function openSaleEditor(page: Page, type: string) {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Select sale type" });
  await expect(chooser).toBeVisible();
  if (process.env.SAUI_CAPTURE_DISCOUNTS_EDITOR === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/sale-chooser-1440.png",
      animations: "disabled",
    });
  }
  await chooser.getByRole("button", { name: new RegExp(`^${type}`) }).click();
  await expect(chooser).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Create sale" })).toBeVisible();
}

async function mockSaleProducts(page: Page) {
  await page.route("**/api/admin/catalog/products/product-sale-fixture?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "sale-product-detail-fixture",
        value: {
          productId: "product-sale-fixture",
          slug: "mango-sale-fixture",
          name: "Mango",
          categoryCode: "produce",
          status: "active",
          version: 1,
          categoryId: "category-produce",
          categoryName: "Produce",
          categories: [{ categoryId: "category-produce", code: "produce", name: "Produce" }],
          description: null,
          customerDetails: [],
          media: [],
          inventoryPool: {
            inventoryPoolId: "pool-mango",
            baseUnitId: "unit-kilogram",
            baseUnitCode: "GRAM",
            baseUnitSymbol: "g",
            position: null,
          },
          scope: {
            kind: "LOCATION",
            marketId: "market-fixture",
            marketName: "Cebu",
            locationId: "location-fixture",
            locationName: "Central Cebu",
            currency: "PHP",
          },
          allowedActions: ["UPDATE"],
          recentAudit: [],
          skus: [
            {
              skuId: "sku-sale-fixture",
              code: "MANGO_1KG",
              name: "1 kilogram",
              merchandisingLabel: null,
              unitSymbol: "kg",
              sellQuantity: 1,
              consumptionBaseQuantity: 1_000,
              estimatedShippingWeightGrams: null,
              status: "active",
              sortOrder: 0,
              version: 1,
              priceMinor: 12_000,
              currency: "PHP",
              priceVersion: 1,
              availability: "AVAILABLE",
              availabilityVersion: 1,
              availableBase: 50_000,
            },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/admin/catalog/products?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "sale-product-list-fixture",
        value: {
          items: [
            {
              productId: "product-sale-fixture",
              slug: "mango-sale-fixture",
              categoryCode: "produce",
              name: "Mango",
              status: "active",
              skuCount: 1,
              version: 1,
            },
          ],
          nextCursor: null,
        },
      }),
    }),
  );
}

async function addFixedSaleTarget(page: Page) {
  await page.getByLabel("Search sale products", { exact: true }).fill("Mango");
  await page.getByRole("option", { name: /Mango/ }).click();
  await page.getByRole("button", { name: /1 kilogram/ }).click();
  await page.getByLabel(/Fixed clearance pool/).check();
  await page.getByLabel("Fixed pool pieces", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add to sale", exact: true }).click();
}

test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get("/");
    stackUp = response.status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
});

test("an unauthenticated visitor cannot open the promotions workspace", async ({ page }) => {
  await page.goto("/admin/promotions");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("a provisioned Staff reader opens the real Promotion Codes workspace", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/promotions");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Promotion Codes" })).toBeVisible();
});

test("discount indexes keep filters and cursors in the URL and label mixed-page counts", async ({
  adminPage: page,
}) => {
  const requests = await mockMixedPromotionPage(page, "promotion-page-2");
  await page.goto("/admin/promotions?query=Needle&status=draft");

  await expect(page.getByLabel("Search promo codes on this page")).toHaveValue("Needle");
  await expect(page.getByRole("button", { name: "Draft", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/Showing 1 of 1 promotion codes on this page/)).toContainText(
    "Search and status filter this page only",
  );
  if (process.env.SAUI_CAPTURE_DISCOUNTS === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/promotion-codes-1440.png",
      fullPage: true,
    });
  }
  expect(requests[0]?.searchParams.get("query")).toBeNull();
  expect(requests[0]?.searchParams.get("status")).toBeNull();

  await page.getByLabel("Search promo codes on this page").fill("unmatched");
  await expect(
    page.getByText(/No promotion codes match this view on the current page/),
  ).toContainText("may appear on later pages");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  await page.getByLabel("Search promo codes on this page").fill("Needle");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/query=Needle/);
  await expect(page).toHaveURL(/status=draft/);
  await expect(page).toHaveURL(/cursor=promotion-page-2/);
  await expect(page.getByText("Later Needle code", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("cursor")).toBe("promotion-page-2");
  expect(requests.at(-1)?.searchParams.get("query")).toBeNull();

  await page.goto("/admin/sales?query=Needle&status=draft");
  await expect(page.getByLabel("Search inventory sales on this page")).toHaveValue("Needle");
  await expect(page.getByText(/Showing 1 of 1 sales on this page/)).toContainText(
    "Search and status filter this page only",
  );
  if (process.env.SAUI_CAPTURE_DISCOUNTS === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/promotion-sale-1440.png",
      fullPage: true,
    });
  }
});

test("a promotions reader can inspect both indexes without manage controls", async ({
  promotionsReadOnlyPage: page,
}) => {
  await mockMixedPromotionPage(page);

  await page.goto("/admin/promotions");
  await expect(page.getByRole("button", { name: "Create promo code" })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await page.getByRole("button", { name: "Open actions for READ10" }).click();
  await expect(page.getByRole("menuitem", { name: "View details" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit details" })).toHaveCount(0);

  await page.goto("/admin/sales");
  await expect(page.getByRole("button", { name: "New sale" })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await page.getByRole("button", { name: "Open actions for Needle sale" }).click();
  await expect(page.getByRole("menuitem", { name: "View details" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit details" })).toHaveCount(0);
});

test("the full sale editor guards a dirty route exit and explicit discard", async ({
  adminPage: page,
}) => {
  await mockMixedPromotionPage(page);
  await page.goto("/admin/sales");
  await openSaleEditor(page, "Percentage off each unit");
  await page.getByLabel("Sale name", { exact: true }).fill("Dirty weekend sale");
  await page.getByLabel("Discount percentage", { exact: true }).fill("25");

  page.once("dialog", async (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Promotion Codes", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/sales/);
  await expect(page.getByLabel("Sale name", { exact: true })).toHaveValue("Dirty weekend sale");

  page.once("dialog", async (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create sale" })).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Promotion Sale" })).toBeVisible();
});

test("a sale draft summarizes and retries the identical create intent", async ({
  adminPage: page,
}) => {
  const sent: { body: string | null; key: string | undefined }[] = [];
  await mockMixedPromotionPage(page);
  await mockSaleProducts(page);
  await page.route("**/api/admin/promotions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    if (sent.length < 3) return route.abort("failed");
    const submitted = JSON.parse(sent[0]?.body ?? "{}") as {
      code: string;
      productTargets: typeof listedSale.productTargets;
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "sale-create-recovered",
        value: {
          ...listedSale,
          promotionId: "promotion-sale-recovered",
          code: submitted.code,
          name: "Recovery sale",
          benefitType: "ORDER_FIXED_DISCOUNT",
          discountMinor: 1_999,
          productTargets: listedSale.productTargets.map((target) => ({
            ...target,
            skuId: submitted.productTargets[0]?.skuId ?? target.skuId,
            locationId: submitted.productTargets[0]?.locationId ?? target.locationId,
            quantityLimit: submitted.productTargets[0]?.quantityLimit ?? target.quantityLimit,
            remainingQuantity:
              submitted.productTargets[0]?.quantityLimit ?? target.remainingQuantity,
          })),
        },
      }),
    });
  });

  await page.goto("/admin/sales");
  await openSaleEditor(page, "Amount off each unit");
  await page.getByLabel("Sale name", { exact: true }).fill("Recovery sale");
  await page.getByLabel("Amount off in pesos", { exact: true }).fill("19.99");
  await addFixedSaleTarget(page);
  await expect(page.getByText("₱19.99 off each unit", { exact: true })).toBeVisible();
  await expect(page.getByText("1 selling option selected", { exact: true })).toBeVisible();
  await expect(page.getByText("5 fixed sale units across 1 target", { exact: true })).toBeVisible();
  if (process.env.SAUI_CAPTURE_DISCOUNTS_EDITOR === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/sale-editor-1440.png",
      fullPage: true,
      animations: "disabled",
    });
  }

  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/Save outcome unknown/)).toBeVisible();
  await expect(page.getByLabel("Sale name", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check save status", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Promotion Sale" })).toBeVisible();

  expect(sent).toHaveLength(3);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[2]).toEqual(sent[0]);
  expect(sent[0]?.key).toBeTruthy();
  const submitted = JSON.parse(sent[0]?.body ?? "{}") as Record<string, unknown>;
  expect(submitted).toEqual({
    code: expect.stringMatching(/^SALE_[A-Z0-9]{8}$/),
    name: "Recovery sale",
    description: "",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 1_999,
    minimumMinor: 0,
    productTargets: [
      {
        skuId: "sku-sale-fixture",
        locationId: expect.any(String),
        quantityLimit: 5,
      },
    ],
    automatic: true,
    startsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
});

test("a Staff principal without capability is denied the Promotion Codes workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/promotions");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(/requires.*promotions\.read/i);
});

test("the full promotion editor guards a dirty route exit and explicit discard", async ({
  adminPage: page,
}) => {
  await page.goto("/admin/promotions");
  await openPromotionEditor(page, "Percentage off delivery");
  await page.getByLabel("Promotion code", { exact: true }).fill("DIRTY_EXIT");
  await page.getByLabel("Discount percentage", { exact: true }).fill("25");

  page.once("dialog", async (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Promotion Sale", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/promotions/);
  await expect(page.getByLabel("Promotion code", { exact: true })).toHaveValue("DIRTY_EXIT");

  page.once("dialog", async (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create promo code" })).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Promotion Codes" })).toBeVisible();
});

test("an unknown create response locks the draft and checks the identical intent", async ({
  adminPage: page,
}) => {
  const sent: { body: string | null; key: string | undefined }[] = [];
  await page.route("**/api/admin/promotions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    if (sent.length < 3) return route.abort("failed");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "promotion-create-recovered",
        value: {
          ...listedPromotion,
          promotionId: "promotion-recovered",
          code: "UNKNOWN25",
          name: "Unknown delivery result",
          benefitType: "DELIVERY_PERCENT_DISCOUNT",
          discountMinor: null,
          percent: 25,
        },
      }),
    });
  });

  await page.goto("/admin/promotions");
  await openPromotionEditor(page, "Percentage off delivery");
  await page.getByLabel("Promotion code", { exact: true }).fill("UNKNOWN25");
  await page.getByLabel("Promotion name", { exact: true }).fill("Unknown delivery result");
  await page.getByLabel("Discount percentage", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();

  await expect(page.getByText(/Save outcome unknown/)).toBeVisible();
  await expect(page.getByLabel("Promotion code", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check save status", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Promotion Codes" })).toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[2]).toEqual(sent[0]);
});

test("promotion creation succeeds with capability and is denied without it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const suffix = crypto.randomUUID();
  const codeSuffix = suffix.replaceAll("-", "_").toUpperCase();
  const data = {
    code: `E2E_${codeSuffix}`,
    name: "E2E Promotion",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 100,
    minimumMinor: 500,
    startsAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const allowed = await adminPage.request.post("/api/admin/promotions", {
    data,
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  const allowedBody = await allowed.json();
  expect(allowedBody, JSON.stringify(allowedBody)).toMatchObject({
    ok: true,
    value: { code: data.code },
  });
  await adminPage.goto("/admin/promotions");
  await expect(adminPage.getByText(data.code, { exact: true })).toBeVisible();
  const denied = await deniedAdminPage.request.post("/api/admin/promotions", {
    data: { ...data, code: `DENIED_${codeSuffix}` },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

test("creates, edits and activates a campaign through lost browser responses", async ({
  adminPage: page,
}, testInfo) => {
  const code = `REPLAY_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const requests = new Map<string, { body: string | null; key: string | undefined }[]>();
  await page.route("**/api/admin/promotions**", async (route) => {
    if (!["POST", "PATCH"].includes(route.request().method())) return route.continue();
    const path = new URL(route.request().url()).pathname;
    const sent = requests.get(path) ?? [];
    sent.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    requests.set(path, sent);
    if (sent.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true });
    await route.abort("failed");
  });
  await page.goto("/admin/promotions");
  await openPromotionEditor(page, "Amount off order");
  await page.getByLabel("Promotion code", { exact: true }).fill(code);
  await page.getByLabel("Promotion name", { exact: true }).fill("Recovery campaign");
  await page.getByLabel("Fixed discount in pesos", { exact: true }).fill("19.99");
  await page.getByLabel("Minimum purchase in pesos", { exact: true }).fill("125.50");
  await page.getByLabel("Start date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("End date", { exact: true }).fill("2026-10-31");
  await page.getByLabel("Total usage limit", { exact: true }).fill("50");
  await page.getByLabel("Per-customer usage limit", { exact: true }).fill("2");
  await expect(page.getByText("₱19.99 off the order", { exact: true })).toBeVisible();
  await expect(page.getByText("Minimum order subtotal of ₱125.50", { exact: true })).toBeVisible();
  await expect(page.getByText("2 per customer · 50 total", { exact: true })).toBeVisible();
  if (process.env.SAUI_CAPTURE_DISCOUNTS_EDITOR === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/promotion-editor-1440.png",
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: code, exact: true }) });
  await row.getByRole("button", { name: `Open actions for ${code}` }).click();
  await page.getByRole("menuitem", { name: "Edit details", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Weekend campaign");
  await page.getByLabel("Campaign discount", { exact: true }).fill("25.50");
  await page.getByLabel("Campaign minimum purchase", { exact: true }).fill("200.00");
  await page.getByRole("button", { name: "Save campaign", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Weekend campaign" })).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  expect(requests.size).toBe(3);
  const createRequests = requests.get("/api/admin/promotions");
  expect(createRequests).toHaveLength(2);
  expect(JSON.parse(createRequests?.[0]?.body ?? "{}")).toEqual({
    code,
    name: "Recovery campaign",
    description: "",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 1_999,
    minimumMinor: 12_550,
    startsAt: new Date("2026-10-01").toISOString(),
    endsAt: new Date("2026-10-31").toISOString(),
    globalUsageLimit: 50,
    perCustomerUsageLimit: 2,
  });
  for (const sent of requests.values()) {
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  }
  await page.screenshot({ path: testInfo.outputPath("promotion-recovery.png"), fullPage: true });
});

for (const benefit of ["Free delivery", "Delivery percentage off", "Delivery amount off"])
  test(`authors and previews ${benefit} from Admin`, async ({ adminPage: page }, testInfo) => {
    const code = `DELIVERY_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
    await page.goto("/admin/promotions");
    await openPromotionEditor(
      page,
      benefit === "Delivery percentage off"
        ? "Percentage off delivery"
        : benefit === "Delivery amount off"
          ? "Amount off delivery"
          : benefit,
    );
    await page.getByLabel("Promotion code", { exact: true }).fill(code);
    await page.getByLabel("Promotion name", { exact: true }).fill(benefit);
    if (benefit !== "Free delivery")
      await page
        .getByLabel(
          benefit === "Delivery percentage off" ? "Discount percentage" : "Fixed discount in pesos",
          { exact: true },
        )
        .fill(benefit === "Delivery percentage off" ? "25" : "30.00");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: code, exact: true }) });
    await row.getByRole("button", { name: `Open actions for ${code}` }).click();
    await page.getByRole("menuitem", { name: "Edit details", exact: true }).click();
    await page.getByLabel("Campaign maximum discount", { exact: true }).fill("25.50");
    await page.getByLabel("Campaign total redemption limit", { exact: true }).fill("10");
    await page.getByLabel("Campaign customer redemption limit", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Save campaign", exact: true }).click();
    await expect(page.getByLabel("Campaign maximum discount", { exact: true })).toHaveValue(
      "25.50",
    );
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
    await expect(page.getByText("Maximum discount: PHP 25.50", { exact: true })).toBeVisible();
    await expect(page.getByText("Total redemption limit: 10", { exact: true })).toBeVisible();
    await page.getByLabel("Subtotal in pesos", { exact: true }).fill("200.00");
    await page.getByLabel("Delivery fee in pesos", { exact: true }).fill("70.00");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: benefit === "Delivery percentage off" ? "17.50" : "25.50" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("delivery-promotion.png"), fullPage: true });
  });

test("selects a customer for preview and safely retries a customer grant", async ({
  adminPage: page,
  signedInPage,
}, testInfo) => {
  await signedInPage.goto("/account/profile");
  await expect(signedInPage.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  const session = await (await signedInPage.request.get("/api/auth/get-session")).json();
  const email = session.user.email;
  const code = `CUSTOMER_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  await page.goto("/admin/promotions");
  await openPromotionEditor(page, "Amount off order");
  await page.getByLabel("Promotion code", { exact: true }).fill(code);
  await page.getByLabel("Promotion name", { exact: true }).fill("Customer preview campaign");
  await page.getByLabel("Fixed discount in pesos", { exact: true }).fill("25.50");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: code, exact: true }) });
  await row.getByRole("button", { name: `Open actions for ${code}` }).click();
  await page.getByRole("menuitem", { name: "Edit details", exact: true }).click();
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  await page.getByRole("combobox", { name: "Condition 2", exact: true }).click();
  await page.getByRole("option", { name: "Selected customers", exact: true }).click();
  await page.getByLabel("Eligible customer 2", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Search eligible customer 2", exact: true }).click();
  await page.getByRole("button", { name: email, exact: true }).click();
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  await page.getByRole("combobox", { name: "Condition 3", exact: true }).click();
  await page.getByRole("option", { name: "Minimum merchandise purchase", exact: true }).click();
  await page.getByLabel("Condition 3 minimum purchase", { exact: true }).fill("150.75");
  const audienceRequests: { body: string | null; key: string | undefined }[] = [];
  await page.route("**/api/admin/promotions/*/audience", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    audienceRequests.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    const response = await route.fetch();
    expect(await response.json()).toMatchObject({ ok: true });
    if (audienceRequests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save audience", exact: true }).click();
  await expect(page.getByLabel("Condition 3 minimum purchase", { exact: true })).toHaveValue(
    "150.75",
  );
  await expect.poll(() => audienceRequests.length).toBe(2);
  expect(audienceRequests[1]).toEqual(audienceRequests[0]);
  expect(audienceRequests[0]?.key).toBeTruthy();
  await expect(page.getByRole("status").filter({ hasText: "Audience saved." })).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await page.getByLabel("Preview customer", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Search preview customer", exact: true }).click();
  await page.getByRole("button", { name: email, exact: true }).click();
  await page.getByLabel("Subtotal in pesos", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Customer is not eligible" }),
  ).toBeVisible();
  await page.getByLabel("Subtotal in pesos", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Eligible discount" })).toContainText(
    "25.50",
  );
  await page.getByLabel("Grant customer", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Search grant customer", exact: true }).click();
  await page.getByRole("button", { name: email, exact: true }).click();
  const sent: { body: string | null; key: string | undefined }[] = [];
  await page.route("**/api/admin/promotions/*/grants", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    const response = await route.fetch();
    expect(await response.json()).toMatchObject({ ok: true });
    if (sent.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Grant to customer", exact: true }).click();
  await expect(page.getByRole("link", { name: "View customer", exact: true })).toHaveCount(1);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]?.key).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("customer-promotion.png"), fullPage: true });
});
