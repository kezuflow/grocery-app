import type { APIResponse } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { expect, test } from "./admin-authenticated-fixture";

async function value(response: Pick<APIResponse, "ok" | "json">): Promise<unknown> {
  expect(response.ok()).toBe(true);
  const body: unknown = await response.json();
  const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
  if (error.success) throw new Error(error.data.error.message);
  return z.object({ ok: z.literal(true), value: z.unknown() }).parse(body).value;
}
const versioned = z.object({ version: z.number() });

test("Admin campaign reaches a real customer Quote at the authored code length boundary", async ({
  adminPage: page,
}, testInfo) => {
  test.setTimeout(120000);
  const locationId = "location-cebu-central";
  const reason = "Synthetic local promotion acceptance prerequisites";
  const post = async (path: string, data: Record<string, unknown>) =>
    value(
      await page.request.post(path, {
        data,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
  const schedule = versioned.parse(
    await value(await page.request.get(`/api/admin/location-schedule?locationId=${locationId}`)),
  );
  await post("/api/admin/location-schedule", {
    locationId,
    expectedVersion: schedule.version,
    reason,
    schedule: {
      weekly: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        opensMinute: 0,
        closesMinute: 1440,
      })),
      closures: [],
    },
  });
  const profile = z
    .object({ profile: z.object({ version: z.number() }).nullable() })
    .parse(
      await value(
        await page.request.get(`/api/admin/delivery-location-profile?locationId=${locationId}`),
      ),
    );
  await value(
    await page.request.put("/api/admin/delivery-location-profile", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        locationId,
        expectedVersion: profile.profile?.version ?? 0,
        senderName: "Synthetic dispatch",
        phoneE164: "+639171110000",
        formattedAddress: "Test road, Cebu",
        addressLine1: "Test road",
        city: "Cebu",
        countryCode: "PH",
      },
    }),
  );
  const readiness = versioned.parse(
    await value(await page.request.get(`/api/admin/location-fulfillment?locationId=${locationId}`)),
  );
  await post("/api/admin/location-fulfillment", {
    locationId,
    expectedVersion: readiness.version,
    reason,
    dispatchReady: true,
    instantPromiseMinutes: 90,
  });
  const configuration = z.object({
    version: z.number(),
    sellingState: z.string(),
    fulfillmentMode: z.string(),
  });
  let config = configuration.parse(
    await value(await page.request.get("/api/admin/commerce-configuration")),
  );
  if (config.sellingState === "OPEN") {
    await post("/api/admin/commerce-configuration", {
      action: "PAUSE",
      expectedVersion: config.version,
      reason,
    });
    config = configuration.parse(
      await value(await page.request.get("/api/admin/commerce-configuration")),
    );
  }
  if (config.fulfillmentMode !== "INSTANT") {
    await post("/api/admin/commerce-configuration", {
      action: "SWITCH_MODE",
      fulfillmentMode: "INSTANT",
      cadence: null,
      expectedVersion: config.version,
      reason,
    });
    config = configuration.parse(
      await value(await page.request.get("/api/admin/commerce-configuration")),
    );
  }
  await post("/api/admin/commerce-configuration", {
    action: "OPEN",
    expectedVersion: config.version,
    reason,
  });
  await post("/api/commerce/address", {
    label: "Campaign test address",
    recipient: "Synthetic customer",
    phone: "+639171110001",
    components: {
      addressLine1: "Test customer road",
      addressLine2: null,
      barangay: null,
      city: "Cebu",
      region: "Cebu",
      postalCode: null,
      countryCode: "PH",
    },
    componentsSource: "FIRST_PARTY",
    latitude: 10.32,
    longitude: 123.9,
    confirmationSource: "USER_PIN",
    instructions: {
      buildingUnit: null,
      landmark: null,
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    },
  });
  const cart = z
    .object({ id: z.string(), version: z.number() })
    .parse(await value(await page.request.get("/api/commerce/cart")));
  await post("/api/commerce/cart", {
    cartId: cart.id,
    expectedVersion: cart.version,
    skuId: "sku-red-onion-500g",
    quantity: 10,
    idempotencyKey: crypto.randomUUID(),
  });
  const code = `QUOTE_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`.padEnd(80, "X");
  await page.goto("/admin/promotions");
  await page.getByLabel("Promotion code", { exact: true }).fill(code);
  await page.getByLabel("Promotion name", { exact: true }).fill("Authored customer quote campaign");
  await page.getByLabel("Fixed discount in pesos", { exact: true }).fill("5.00");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: code, exact: true }) })
    .getByRole("link", { name: "Manage", exact: true })
    .click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Verify real customer promotion application");
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Promotion code", { exact: true }).fill(code);
  await expect(page.getByLabel("Promotion code", { exact: true })).toHaveValue(code);
  await page.getByRole("button", { name: "Add code", exact: true }).click();
  await page.getByRole("radio").first().check();
  const quoteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/checkout/quote") && response.request().method() === "POST",
  );
  await page
    .getByRole("group", { name: "Fulfillment option", exact: true })
    .getByRole("button")
    .first()
    .click();
  const quote = z
    .object({
      orderDiscountMinor: z.number(),
      totalMinor: z.number(),
      currency: z.string(),
      promotionFeedback: z.array(z.object({ code: z.string(), status: z.string() })),
    })
    .parse(await value(await quoteResponse));
  expect(quote.orderDiscountMinor).toBe(500);
  expect(quote.promotionFeedback).toContainEqual({ code, status: "APPLIED" });
  const review = page.getByRole("region", { name: "Order total review" });
  await expect(review).toContainText("Authored customer quote campaign");
  await expect(review).toContainText(
    new Intl.NumberFormat("en-PH", { style: "currency", currency: quote.currency }).format(
      quote.totalMinor / 100,
    ),
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`authored-promotion-real-quote-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Discard current total and start again", exact: true })
    .click();
  await expect(review).toHaveCount(0);
});
