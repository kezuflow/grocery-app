import type { Page, Route } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";

const promotion = {
  promotionId: "promotion-detail-fixture",
  code: "DETAIL10",
  name: "Detail campaign",
  description: "A recorded campaign",
  status: "DRAFT",
  benefitType: "ORDER_FIXED_DISCOUNT",
  discountMinor: 1_000,
  percent: null,
  maximumDiscountMinor: null,
  minimumMinor: 2_500,
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: null,
  globalUsageLimit: 100,
  perCustomerUsageLimit: 2,
  automatic: false,
  priority: 0,
  version: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
} as const;

const sale = {
  ...promotion,
  promotionId: "sale-detail-fixture",
  code: "SALE_DETAIL",
  name: "Mango sale",
  automatic: true,
  productTargets: [
    {
      skuId: "sku-mango",
      locationId: "location-central",
      quantityLimit: 20,
      remainingQuantity: 12,
      productName: "Mango",
      skuName: "1 kilogram",
      locationName: "Central Cebu",
    },
  ],
} as const;

function rpc(value: unknown) {
  return { ok: true, requestId: "discount-detail-fixture", value };
}

function failed(message: string, requestId: string) {
  return { ok: false, error: { code: "FORBIDDEN", message, requestId } };
}

async function fulfill(route: Route, body: unknown) {
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

async function mockPromotionDetail(
  page: Page,
  options: {
    historyFailure?: boolean;
    record?: { promotionId: string; version: number; [key: string]: unknown };
  } = {},
) {
  const record = options.record ?? promotion;
  await page.route("**/api/admin/promotions/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/audience")) {
      await fulfill(
        route,
        rpc({
          promotionId: record.promotionId,
          version: record.version,
          rules: [{ type: "FIRST_ORDER", parameters: {} }],
          unsupportedRuleCount: 0,
          segments: [],
          moreSegments: false,
          customers: [],
        }),
      );
      return;
    }
    if (pathname.endsWith("/grants")) {
      await fulfill(
        route,
        options.historyFailure
          ? failed("Grant history is not available to this caller.", "grant-history-request")
          : rpc({ items: [], nextCursor: null }),
      );
      return;
    }
    if (pathname.endsWith("/redemptions")) {
      await fulfill(
        route,
        options.historyFailure
          ? failed(
              "Redemption history is not available to this caller.",
              "redemption-history-request",
            )
          : rpc({ items: [], nextCursor: null }),
      );
      return;
    }
    if (pathname.endsWith("/preview")) {
      await fulfill(
        route,
        rpc({ eligibilityChecked: false, eligible: true, discountMinor: 1_000, reasonCode: null }),
      );
      return;
    }
    await fulfill(route, rpc(record));
  });
}

test("Global promotion readers keep detail, audience, history, and preview without mutation controls", async ({
  promotionsReadOnlyPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockPromotionDetail(page);
  await page.goto(`/admin/promotions/${promotion.promotionId}`);

  await expect(page.getByRole("heading", { level: 1, name: promotion.name })).toBeVisible();
  if (process.env.SAUI_CAPTURE_DISCOUNTS_DETAIL === "1") {
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/promotion-detail-readonly-1440.png",
      fullPage: true,
      animations: "disabled",
    });
  }
  await expect(page.getByText("First order", { exact: true })).toBeVisible();
  await expect(page.getByText("No grants yet.", { exact: true })).toBeVisible();
  await expect(page.getByText("No redemptions recorded.", { exact: true })).toBeVisible();
  await page.getByLabel("Subtotal in pesos", { exact: true }).fill("100.00");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Estimated discount" })).toContainText(
    "10.00",
  );

  for (const name of [
    "Save campaign",
    "Add condition",
    "Save audience",
    "Activate",
    "Deactivate",
    "Archive",
    "Grant to customer",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel("Grant customer", { exact: true })).toHaveCount(0);
});

test("promotion detail reports failed history reads instead of empty history", async ({
  adminPage: page,
}) => {
  await mockPromotionDetail(page, { historyFailure: true });
  await page.goto(`/admin/promotions/${promotion.promotionId}`);

  await expect(page.getByText("Grant history unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/grant-history-request/)).toBeVisible();
  await expect(page.getByText("Redemption history unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/redemption-history-request/)).toBeVisible();
  await expect(page.getByText("No grants yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No redemptions recorded.", { exact: true })).toHaveCount(0);
});

test("confirmed promotion status remains visible when its readback fails", async ({
  adminPage: page,
}) => {
  let primaryReads = 0;
  await page.route("**/api/admin/promotions/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/audience")) {
      await fulfill(
        route,
        rpc({
          promotionId: promotion.promotionId,
          version: promotion.version,
          rules: [],
          unsupportedRuleCount: 0,
          segments: [],
          moreSegments: false,
          customers: [],
        }),
      );
      return;
    }
    if (pathname.endsWith("/grants") || pathname.endsWith("/redemptions")) {
      await fulfill(route, rpc({ items: [], nextCursor: null }));
      return;
    }
    if (pathname.endsWith("/status")) {
      await fulfill(route, rpc({ ...promotion, status: "ACTIVE", version: 4 }));
      return;
    }
    primaryReads += 1;
    if (primaryReads === 1) await fulfill(route, rpc(promotion));
    else await route.abort("failed");
  });

  await page.goto(`/admin/promotions/${promotion.promotionId}`);
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The change is confirmed, but the latest promotion could not be refreshed."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: promotion.name })).toBeVisible();
});

test("confirmed sale edit remains visible when its readback fails", async ({ adminPage: page }) => {
  let primaryReads = 0;
  await page.route("**/api/admin/promotions/**", async (route) => {
    if (route.request().method() === "PATCH") {
      await fulfill(route, rpc({ ...sale, name: "Saved mango sale", version: 4 }));
      return;
    }
    primaryReads += 1;
    if (primaryReads === 1) await fulfill(route, rpc(sale));
    else await route.abort("failed");
  });

  await page.goto(`/admin/sales/${sale.promotionId}`);
  await page.getByRole("button", { name: "Edit sale", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Saved mango sale");
  await page.getByRole("button", { name: "Save campaign", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Saved mango sale" })).toBeVisible();
  await expect(
    page.getByText("The sale is saved, but the latest record could not be refreshed."),
  ).toBeVisible();
});

for (const expected of ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const) {
  test(`sale detail presents ${expected} truthfully to a read-only promotion reader`, async ({
    promotionsReadOnlyPage: page,
  }) => {
    const record = { ...sale, status: expected };
    await mockPromotionDetail(page, { record });
    await page.goto(`/admin/sales/${sale.promotionId}`);

    await expect(page.getByRole("heading", { level: 1, name: sale.name })).toBeVisible();
    await expect(
      page.getByText(expected[0] + expected.slice(1).toLowerCase(), { exact: true }),
    ).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Edit sale", exact: true })).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByText("More actions", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Last updated", { exact: true })).toBeVisible();
    await expect(page.getByText("Created", { exact: true })).toBeVisible();
    if (expected === "INACTIVE" && process.env.SAUI_CAPTURE_DISCOUNTS_DETAIL === "1") {
      await page.setViewportSize({ width: 1440, height: 1200 });
      await page.screenshot({
        path: "../../docs/operations/checkpoints/evidence/saui-06/sale-detail-inactive-1440.png",
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}

test("discount detail routes reject callers without Global promotions.read before record reads", async ({
  deniedAdminPage: page,
}) => {
  let detailReads = 0;
  await page.route("**/api/admin/promotions/**", async (route) => {
    detailReads += 1;
    await fulfill(route, rpc(promotion));
  });

  await page.goto(`/admin/promotions/${promotion.promotionId}`);
  await expect(page.getByText("Promotion access denied", { exact: true })).toBeVisible();
  await page.goto(`/admin/sales/${sale.promotionId}`);
  await expect(page.getByText("Promotion Sale access denied", { exact: true })).toBeVisible();
  expect(detailReads).toBe(0);
});

test("local Core keeps sale activation, overlap denial, and lifecycle authoritative", async ({
  adminPage,
  promotionsReadOnlyPage,
}) => {
  test.setTimeout(90_000);
  const token = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const startsAt = new Date(Date.now() - 60_000).toISOString();
  const target = { skuId: "sku-abiu-1pc", locationId: "location-cebu-central", quantityLimit: 5 };
  const create = async (suffix: string) => {
    const response = await adminPage.request.post("/api/admin/promotions", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        code: `SALE_SAUI_${token}_${suffix}`,
        name: `SAUI local sale ${suffix}`,
        description: "",
        benefitType: "ORDER_FIXED_DISCOUNT",
        discountMinor: 500,
        minimumMinor: 0,
        productTargets: [target],
        automatic: true,
        startsAt,
      },
    });
    const body = await response.json();
    expect(body, JSON.stringify(body)).toMatchObject({
      ok: true,
      value: { status: "DRAFT", benefitType: "ORDER_FIXED_DISCOUNT", discountMinor: 500 },
    });
    return body.value as { promotionId: string; version: number; status: string };
  };
  const changeStatus = async (promotionId: string, action: string, expectedVersion: number) => {
    const response = await adminPage.request.post(
      `/api/admin/promotions/${encodeURIComponent(promotionId)}/status`,
      {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: { action, expectedVersion },
      },
    );
    return response.json() as Promise<{
      ok: boolean;
      value?: {
        promotionId: string;
        version: number;
        status: string;
        productTargets?: Array<{ remainingQuantity: number | null }>;
      };
      error?: { code: string; message: string };
    }>;
  };

  const first = await create("A");
  const second = await create("B");
  const activatedFirst = await changeStatus(first.promotionId, "ACTIVATE", first.version);
  expect(activatedFirst, JSON.stringify(activatedFirst)).toMatchObject({
    ok: true,
    value: { status: "ACTIVE" },
  });
  expect(activatedFirst.value?.productTargets?.[0]?.remainingQuantity).toBeLessThanOrEqual(5);

  const denied = await promotionsReadOnlyPage.request.post(
    `/api/admin/promotions/${encodeURIComponent(first.promotionId)}/status`,
    {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { action: "DEACTIVATE", expectedVersion: activatedFirst.value!.version },
    },
  );
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

  const overlap = await changeStatus(second.promotionId, "ACTIVATE", second.version);
  expect(overlap).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  expect(overlap.error?.message).toMatch(/same selling option and location/i);
  const rejectedDraft = await adminPage.request.get(
    `/api/admin/promotions/${encodeURIComponent(second.promotionId)}`,
  );
  expect(await rejectedDraft.json()).toMatchObject({ ok: true, value: { status: "DRAFT" } });

  const inactiveFirst = await changeStatus(
    first.promotionId,
    "DEACTIVATE",
    activatedFirst.value!.version,
  );
  expect(inactiveFirst).toMatchObject({ ok: true, value: { status: "INACTIVE" } });
  const archivedFirst = await changeStatus(
    first.promotionId,
    "ARCHIVE",
    inactiveFirst.value!.version,
  );
  expect(archivedFirst).toMatchObject({ ok: true, value: { status: "ARCHIVED" } });

  const activatedSecond = await changeStatus(second.promotionId, "ACTIVATE", second.version);
  expect(activatedSecond).toMatchObject({ ok: true, value: { status: "ACTIVE" } });
  const inactiveSecond = await changeStatus(
    second.promotionId,
    "DEACTIVATE",
    activatedSecond.value!.version,
  );
  expect(inactiveSecond).toMatchObject({ ok: true, value: { status: "INACTIVE" } });
  const archivedSecond = await changeStatus(
    second.promotionId,
    "ARCHIVE",
    inactiveSecond.value!.version,
  );
  expect(archivedSecond).toMatchObject({ ok: true, value: { status: "ARCHIVED" } });
});
