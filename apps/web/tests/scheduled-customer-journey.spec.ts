import { createHash } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { test, expect } from "./admin-authenticated-fixture";
import { completeLocalCourierDelivery } from "./signed-delivery-events";

async function value(response: Pick<APIResponse, "ok" | "json">): Promise<unknown> {
  const data: unknown = await response.json();
  const failure = z
    .object({ ok: z.literal(false), error: z.object({ message: z.string() }) })
    .safeParse(data);
  if (failure.success) throw new Error(failure.data.error.message);
  expect(response.ok()).toBe(true);
  return z.object({ ok: z.literal(true), value: z.unknown() }).parse(data).value;
}
const versioned = z.object({ version: z.number() });
const orders = z.object({ items: z.array(z.object({ id: z.string() })) });
const locationId = "location-cebu-central",
  marketId = "market-metro-cebu",
  skuId = "sku-red-onion-500g";
const reason = "Synthetic Scheduled customer journey";
test.describe.configure({ timeout: 300000 });

for (const width of [1440, 390]) {
  test(`Scheduled checkout, paid addition, packing and manual delivery at ${width}px`, async ({
    adminPage: admin,
    signedInPage: page,
  }, testInfo) => {
    test.skip(
      process.env.E2E_PROVIDER_GATEWAY !== "1",
      "Requires the managed test-provider ingress.",
    );
    test.setTimeout(300000);
    page.setDefaultTimeout(10000);
    admin.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 1000 });
    await admin.setViewportSize({ width, height: 1000 });
    const post = async (target: Page, path: string, data: Record<string, unknown>) =>
      value(
        await target.request.post(path, {
          data,
          headers: { "idempotency-key": crypto.randomUUID() },
        }),
      );
    const read = async (target: Page, path: string) => value(await target.request.get(path));
    // Only auth/email verification and IAM use the shared fixture's SQL. All commerce
    // below is created through real commands; payment evidence is explicitly fake.
    const rejected = await page.request.post("/webhooks/payments/mock", { data: {} });
    expect(rejected.status()).toBe(400);
    const schedule = versioned.parse(
      await read(admin, `/api/admin/location-schedule?locationId=${locationId}`),
    );
    await post(admin, "/api/admin/location-schedule", {
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
      .object({ profile: versioned.nullable() })
      .parse(await read(admin, `/api/admin/delivery-location-profile?locationId=${locationId}`));
    await value(
      await admin.request.put("/api/admin/delivery-location-profile", {
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
      await read(admin, `/api/admin/location-fulfillment?locationId=${locationId}`),
    );
    await post(admin, "/api/admin/location-fulfillment", {
      locationId,
      expectedVersion: readiness.version,
      reason,
      dispatchReady: true,
      instantPromiseMinutes: 90,
    });
    const product = z
      .object({
        inventoryPool: z.object({
          position: z
            .object({ onHandBase: z.number(), reservedBase: z.number(), availableBase: z.number() })
            .nullable(),
        }),
        skus: z.array(
          z.object({
            skuId: z.string(),
            priceVersion: z.number().nullable(),
            availabilityVersion: z.number().nullable(),
          }),
        ),
      })
      .parse(
        await read(
          admin,
          `/api/admin/catalog/products/product-red-onion?scopeKind=LOCATION&marketId=${marketId}&locationId=${locationId}`,
        ),
      );
    const sku = product.skus.find((item) => item.skuId === skuId);
    if (!sku) throw new Error("Missing seeded catalog option");
    await post(admin, `/api/admin/catalog/skus/${skuId}/price`, {
      marketId,
      locationId,
      currency: "PHP",
      amountMinor: 100000,
      validFrom: Date.now(),
      expectedVersion: sku.priceVersion ?? 0,
    });
    await value(
      await admin.request.put(`/api/admin/catalog/skus/${skuId}/availability`, {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          locationId,
          availabilityStatus: "AVAILABLE",
          expectedVersion: sku.availabilityVersion ?? 0,
        },
      }),
    );
    const configSchema = z.object({
      version: z.number(),
      sellingState: z.string(),
      fulfillmentMode: z.string(),
    });
    let config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    if (config.sellingState === "OPEN") {
      await post(admin, "/api/admin/commerce-configuration", {
        action: "PAUSE",
        expectedVersion: config.version,
        reason,
      });
      config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    }
    if (config.fulfillmentMode !== "SCHEDULED") {
      await post(admin, "/api/admin/commerce-configuration", {
        action: "SWITCH_MODE",
        fulfillmentMode: "SCHEDULED",
        cadence: "WEEKLY",
        expectedVersion: config.version,
        reason,
      });
      config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    }
    const destinations = z
      .object({ items: z.array(z.object({ zoneId: z.string(), locationId: z.string() })) })
      .parse(await read(admin, `/api/admin/delivery-cycles?marketId=${marketId}`));
    const destination = destinations.items.find((item) => item.locationId === locationId);
    if (!destination) throw new Error("Missing cycle destination");
    const cutoff = Date.now() + 120000,
      at = (offset: number) => new Date(cutoff + offset).toISOString();
    const cycle = z.object({ cycleId: z.string(), version: z.number() }).parse(
      await post(admin, "/api/admin/delivery-cycles", {
        action: "SAVE",
        marketId,
        name: `Customer journey ${crypto.randomUUID()}`,
        expectedVersion: 0,
        reason,
        orderOpensAt: new Date(Date.now() - 1000).toISOString(),
        cutoffAt: at(0),
        procurementAt: at(0),
        preparationAt: at(1000),
        pickupAt: at(3600000),
        windows: [{ name: "Afternoon", startsAt: at(3600000), endsAt: at(7200000) }],
        participation: [destination],
      }),
    );
    await post(admin, "/api/admin/delivery-cycles", {
      action: "SCHEDULE",
      cycleId: cycle.cycleId,
      expectedVersion: cycle.version,
      reason,
    });
    expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
    await post(admin, "/api/admin/commerce-configuration", {
      action: "OPEN",
      expectedVersion: config.version,
      reason,
    });
    await post(page, "/api/commerce/address", {
      label: "Journey address",
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
    // The provider-hosted page is the sole browser response fake. It has no
    // financial-success authority; signed events go to the actual Core webhook.
    await page.route("**/development/mock-payments/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Test payment provider</h1>" }),
    );
    async function confirmTestPayment(amountMinor: number) {
      await expect(page).toHaveURL(/\/development\/mock-payments\//);
      const url = new URL(page.url());
      const reference = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const body = JSON.stringify({
        eventId: crypto.randomUUID(),
        reference,
        vendorState: "paid",
        amountMinor,
        currency: "PHP",
      });
      const headers = {
        "content-type": "application/json",
        "x-mock-timestamp": String(Date.now()),
        "x-mock-signature": createHash("sha256")
          .update(`mock-provider-test-secret:${body}`)
          .digest("hex"),
      };
      expect(
        await value(await page.request.post("/webhooks/payments/mock", { data: body, headers })),
      ).toMatchObject({ processingStatus: "APPLIED" });
      expect(
        await value(await page.request.post("/webhooks/payments/mock", { data: body, headers })),
      ).toMatchObject({ processingStatus: "DUPLICATE" });
      // Provider acceptance and downstream Order application are separate durable stages.
      expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
      await page.goto(url.searchParams.get("returnTo") ?? "/orders");
    }
    async function checkout(quantity: number) {
      const before = orders.parse(await read(page, "/api/commerce/orders"));
      const loadedCart = page.waitForResponse(
        async (response) =>
          response.url().endsWith("/api/commerce/cart") &&
          response.request().method() === "GET" &&
          (await response.json()).ok === true,
      );
      await page.goto("/cart");
      const cart = z
        .object({ id: z.string(), version: z.number() })
        .parse(await value(await loadedCart));
      await post(page, "/api/commerce/cart", {
        cartId: cart.id,
        expectedVersion: cart.version,
        skuId,
        quantity,
        idempotencyKey: crypto.randomUUID(),
      });
      await page.goto("/checkout");
      await page.getByRole("radio").first().check();
      if (quantity > 40) {
        await expect(
          page.getByText("An order including additions cannot exceed 20 kg", { exact: true }),
        ).toBeVisible();
        expect(orders.parse(await read(page, "/api/commerce/orders")).items).toEqual(before.items);
        return "";
      }
      const quoteResponse = page.waitForResponse(
        (r) => r.url().endsWith("/api/checkout/quote") && r.request().method() === "POST",
      );
      await page
        .getByRole("group", { name: "Fulfillment option", exact: true })
        .getByRole("button")
        .first()
        .click();
      const quote = z
        .object({ totalMinor: z.number(), merchandiseSubtotalMinor: z.number() })
        .parse(await value(await quoteResponse));
      expect(quote.merchandiseSubtotalMinor).toBe(quantity * 100000);
      await page
        .getByRole("button", { name: "Accept total and continue to payment", exact: true })
        .click();
      await expect(page).toHaveURL(/\/development\/mock-payments\//);
      expect(orders.parse(await read(page, "/api/commerce/orders")).items).toEqual(before.items);
      await confirmTestPayment(quote.totalMinor);
      const current = orders.parse(await read(page, "/api/commerce/orders"));
      const created = current.items.filter(
        (item) => !before.items.some((old) => old.id === item.id),
      );
      expect(created).toHaveLength(1);
      const order = created[0];
      if (!order) throw new Error("Missing committed Order");
      return order.id;
    }
    await checkout(41);
    const orderId = await checkout(2);
    expect(
      await (
        await admin.request.get(`/api/commerce/orders/${orderId}/amendments?query=Red`)
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await page.goto(`/orders/${orderId}`);
    await page.getByLabel("Find a product", { exact: true }).fill("Red onion");
    await page.getByRole("button", { name: "Search products", exact: true }).click();
    const choice = page.getByRole("combobox", { name: "Product to add", exact: true });
    await expect(choice).toBeVisible();
    await choice.selectOption(skuId);
    await page
      .getByRole("region", { name: "Add items before cutoff", exact: true })
      .screenshot({ path: testInfo.outputPath(`scheduled-addition-picker-${width}.png`) });
    const draftAttempts: { body: string | null; key: string | undefined }[] = [];
    await page.route(`**/api/commerce/orders/${orderId}/amendments`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      draftAttempts.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (draftAttempts.length > 1) return route.continue();
      await value(await route.fetch());
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Price addition", exact: true }).click();
    await expect(
      page.getByText("The addition could not be confirmed.", { exact: false }),
    ).toBeVisible();
    await expect(choice).toBeDisabled();
    await expect(page.getByLabel("Quantity", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Price addition", exact: true }).click();
    expect(draftAttempts).toHaveLength(2);
    expect(draftAttempts[1]).toEqual(draftAttempts[0]);
    const paymentAttempts: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/commerce/amendments/*/payment", async (route) => {
      paymentAttempts.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (paymentAttempts.length > 1) return route.continue();
      await value(await route.fetch());
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Accept total and pay", exact: true }).click();
    await expect(page.getByText("Payment could not be confirmed.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Accept total and pay", exact: true }).click();
    expect(paymentAttempts).toHaveLength(2);
    expect(paymentAttempts[1]).toEqual(paymentAttempts[0]);
    await confirmTestPayment(100000);
    const courierOrderId = await checkout(1);
    const canceledOrderId = await checkout(1);
    await page.goto(`/orders/${canceledOrderId}`);
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    await page
      .getByLabel("Reason for cancellation", { exact: true })
      .fill("Synthetic eligible cancellation");
    await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
    await expect
      .poll(
        async () =>
          z
            .object({ cancellation: z.object({ status: z.string().nullable() }) })
            .parse(await read(page, `/api/commerce/orders/${canceledOrderId}`)).cancellation.status,
      )
      .toBe("REFUNDS_PROCESSING");
    // Normal changeover must preserve outstanding paid Scheduled goods. Keep
    // new selling paused in Instant while completing this existing cycle below.
    const paidSnapshot = z.object({
      status: z.string(),
      version: z.number(),
      financial: z.unknown(),
      items: z.array(z.unknown()),
      payments: z.array(z.unknown()),
      amendments: z.array(z.unknown()),
      fulfillment: z.object({ mode: z.literal("SCHEDULED"), cycleId: z.string() }).passthrough(),
    });
    const beforeChangeover = paidSnapshot.parse(
      await read(page, `/api/commerce/orders/${orderId}`),
    );
    config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    await post(admin, "/api/admin/commerce-configuration", {
      action: "PAUSE",
      expectedVersion: config.version,
      reason: "Synthetic normal changeover with an outstanding Scheduled order",
    });
    config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    await post(admin, "/api/admin/commerce-configuration", {
      action: "SWITCH_MODE",
      fulfillmentMode: "INSTANT",
      cadence: null,
      expectedVersion: config.version,
      reason: "Synthetic normal changeover with an outstanding Scheduled order",
    });
    expect(
      configSchema.parse(await read(admin, "/api/admin/commerce-configuration")),
    ).toMatchObject({
      sellingState: "PAUSED",
      fulfillmentMode: "INSTANT",
    });
    expect(paidSnapshot.parse(await read(page, `/api/commerce/orders/${orderId}`))).toEqual(
      beforeChangeover,
    );
    await expect
      .poll(() => Date.now() >= cutoff, { timeout: 125000, intervals: [1000] })
      .toBe(true);
    expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
    await admin.goto("/admin/procurement");
    await admin.getByRole("combobox", { name: "Active admin scope" }).click();
    await admin.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await admin
      .getByRole("combobox", { name: "Delivery week", exact: true })
      .selectOption(cycle.cycleId);
    const demand = admin.getByRole("article").filter({ hasText: "Red onion · 500 g" });
    await expect(demand).toContainText("2,000");
    await demand.getByRole("button", { name: "Confirm purchase", exact: true }).click();
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm purchase", exact: true })
      .click();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await admin.getByRole("link", { name: "Receiving", exact: true }).click();
    const row = admin.getByRole("row").filter({ hasText: "Red onion" });
    await row.getByRole("button", { name: "Start receiving", exact: true }).click();
    await row.getByLabel(/^Accepted quantity /).fill("2000");
    await row.getByLabel(/^Receiving reason /).fill("Inspected all purchased goods");
    await row.getByRole("button", { name: "Record line", exact: true }).click();
    await expect(row).toContainText("2000 / 0");
    await admin.goto("/admin/delivery");
    const courierRow = admin.getByRole("row").filter({ hasText: courierOrderId });
    await expect(courierRow).toContainText("Start preparation");
    await admin.goto("/admin/fulfillment");
    const courierFulfillment = admin.getByRole("row").filter({ hasText: courierOrderId });
    await courierFulfillment
      .getByRole("button", { name: "Accept order & start picking", exact: true })
      .click();
    await admin.goto("/admin/delivery");
    await expect(
      courierRow.getByRole("radio", { name: "Request a driver now", exact: true }),
    ).toBeDisabled();
    await expect(
      courierRow.getByRole("radio", { name: "Schedule pickup", exact: true }),
    ).toBeChecked();
    const pickupInput = await admin.evaluate(
      (time) =>
        new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      cutoff + 5_400_000,
    );
    await courierRow.getByLabel("Pickup time", { exact: true }).fill(pickupInput);
    await courierRow.getByRole("button", { name: "Review Lalamove booking", exact: true }).click();
    await admin.getByRole("button", { name: "Confirm and book", exact: true }).click();
    await expect(courierRow).toContainText("Finding rider");
    await admin.screenshot({
      path: testInfo.outputPath(`scheduled-future-booking-${width}.png`),
      fullPage: true,
    });
    await admin.goto("/admin/fulfillment");
    for (const name of ["Finish picking", "Start packing", "Finish packing"])
      await courierFulfillment.getByRole("button", { name, exact: true }).click();
    await expect(courierFulfillment).toContainText("PACKED");
    await admin.goto("/admin/delivery");
    // Real booking/cancellation commands with the explicit local fake provider.
    // Definite pre-handover closure must expose the same ordinary manual action.
    admin.once("dialog", (dialog) => dialog.accept());
    await courierRow.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(courierRow).toContainText("CANCELED");
    await courierRow.getByRole("radio", { name: "Schedule pickup", exact: true }).check();
    await courierRow.getByLabel("Pickup time", { exact: true }).fill(pickupInput);
    await courierRow.getByRole("button", { name: "Review Lalamove booking", exact: true }).click();
    await admin.getByRole("button", { name: "Confirm and book", exact: true }).click();
    await expect(courierRow).toContainText("Finding rider");
    admin.once("dialog", (dialog) => dialog.accept());
    await courierRow.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(courierRow).toContainText("CANCELED");
    await courierRow.getByRole("button", { name: "Assign manual delivery", exact: true }).click();
    await courierRow
      .getByLabel("Person delivering", { exact: true })
      .fill("Synthetic fallback helper");
    await courierRow
      .getByLabel("Phone including country code", { exact: true })
      .fill("+639171110002");
    await courierRow
      .getByLabel("Reason for manual delivery", { exact: true })
      .fill("Courier canceled before pickup");
    await courierRow.getByRole("button", { name: "Assign manual delivery", exact: true }).click();
    await expect(courierRow).toContainText("Manual · Synthetic fallback helper");
    await expect(
      courierRow.getByRole("button", { name: "Hand over packed order", exact: true }),
    ).toBeVisible();
    await admin.screenshot({
      path: testInfo.outputPath(`scheduled-canceled-courier-fallback-${width}.png`),
      fullPage: true,
    });
    // The helper becomes unavailable before handover; the packed order can use a courier again.
    await courierRow.getByRole("button", { name: "Record delivery failure", exact: true }).click();
    await courierRow
      .getByLabel("What went wrong", { exact: true })
      .fill("Helper unavailable before pickup; groceries remain packed at the facility");
    await courierRow.getByRole("button", { name: "Record delivery failure", exact: true }).click();
    await expect(courierRow).toContainText("FAILED");
    await courierRow.getByRole("radio", { name: "Request a driver now", exact: true }).check();
    await courierRow.getByRole("button", { name: "Review Lalamove booking", exact: true }).click();
    await admin.getByRole("button", { name: "Confirm and book", exact: true }).click();
    await expect(courierRow).toContainText("Finding rider");
    await completeLocalCourierDelivery(admin, page, courierOrderId, locationId);
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-courier-delivered-${width}.png`),
      fullPage: true,
    });
    const manualRow = admin.getByRole("row").filter({ hasText: orderId });
    await manualRow.getByRole("button", { name: "Assign manual delivery", exact: true }).click();
    await manualRow
      .getByLabel("Person delivering", { exact: true })
      .fill("Synthetic delivery helper");
    await manualRow
      .getByLabel("Phone including country code", { exact: true })
      .fill("+639171110000");
    await manualRow
      .getByLabel("Reason for manual delivery", { exact: true })
      .fill("Synthetic courier unavailability");
    await manualRow.getByRole("button", { name: "Assign manual delivery", exact: true }).click();
    await expect(manualRow).toContainText("Manual · Synthetic delivery helper");
    await expect(
      manualRow.getByRole("button", { name: "Hand over packed order", exact: true }),
    ).toHaveCount(0);
    await admin.goto("/admin/fulfillment");
    const fulfillment = admin.getByRole("row").filter({ hasText: orderId });
    for (const name of [
      "Accept order & start picking",
      "Finish picking",
      "Start packing",
      "Finish packing",
    ]) {
      await fulfillment.getByRole("button", { name, exact: true }).click();
    }
    await expect(fulfillment).toContainText("PACKED");
    const finalStock = z
      .object({
        inventoryPool: z.object({
          position: z
            .object({ onHandBase: z.number(), reservedBase: z.number(), availableBase: z.number() })
            .nullable(),
        }),
      })
      .parse(
        await read(
          admin,
          `/api/admin/catalog/products/product-red-onion?scopeKind=LOCATION&marketId=${marketId}&locationId=${locationId}`,
        ),
      );
    expect(finalStock.inventoryPool.position).toEqual(product.inventoryPool.position);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await admin.screenshot({
      path: testInfo.outputPath(`scheduled-customer-packed-${width}.png`),
      fullPage: true,
    });
    await expect(fulfillment.getByRole("button", { name: "Hand off", exact: true })).toHaveCount(0);
    await admin.goto("/admin/delivery");
    await manualRow.getByRole("button", { name: "Hand over packed order", exact: true }).click();
    await manualRow.getByRole("button", { name: "Hand over packed order", exact: true }).click();
    await expect(manualRow).toContainText("Handed over");
    await manualRow.scrollIntoViewIfNeeded();
    await admin.screenshot({
      path: testInfo.outputPath(`scheduled-manual-handover-${width}.png`),
      fullPage: true,
    });
    await manualRow.getByRole("button", { name: "Record delivery failure", exact: true }).click();
    await manualRow
      .getByLabel("What went wrong", { exact: true })
      .fill("Customer unavailable; goods returned for review");
    await manualRow.getByRole("button", { name: "Record delivery failure", exact: true }).click();
    await expect(manualRow).toContainText("FAILED");
    await expect(
      manualRow.getByRole("button", { name: "Assign manual delivery", exact: true }),
    ).toHaveCount(0);
    await manualRow.getByRole("button", { name: "Inspect returned order", exact: true }).click();
    await manualRow
      .getByRole("checkbox", {
        name: "All groceries are back at the facility, inspected, suitable and packed for redelivery.",
        exact: true,
      })
      .check();
    await manualRow
      .getByLabel("Return inspection", { exact: true })
      .fill("All groceries returned, checked and packed for the same customer");
    await manualRow
      .getByLabel("Customer agreement", { exact: true })
      .fill("Customer agreed by phone to redelivery this evening");
    const redeliveryAt = new Date(Date.now() + 2 * 3600000);
    await manualRow
      .getByLabel("Deliver by (your local time)")
      .fill(
        new Date(redeliveryAt.getTime() - redeliveryAt.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16),
      );
    await manualRow.scrollIntoViewIfNeeded();
    await admin.screenshot({
      path: testInfo.outputPath(`scheduled-return-inspection-${width}.png`),
      fullPage: true,
    });
    await manualRow
      .getByRole("button", { name: "Save inspection and agreed time", exact: true })
      .click();
    await expect(manualRow).toContainText("Returned and inspected");
    expect(
      z
        .object({
          inventoryPool: z.object({
            position: z
              .object({
                onHandBase: z.number(),
                reservedBase: z.number(),
                availableBase: z.number(),
              })
              .nullable(),
          }),
        })
        .parse(
          await read(
            admin,
            `/api/admin/catalog/products/product-red-onion?scopeKind=LOCATION&marketId=${marketId}&locationId=${locationId}`,
          ),
        ).inventoryPool.position,
    ).toEqual(finalStock.inventoryPool.position);
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText("Original promise", { exact: true })).toBeVisible();
    await expect(page.getByText("Agreed delivery time", { exact: true })).toBeVisible();
    await manualRow.getByRole("button", { name: "Assign manual delivery", exact: true }).click();
    await manualRow
      .getByLabel("Person delivering", { exact: true })
      .fill("Synthetic redelivery helper");
    await manualRow
      .getByLabel("Phone including country code", { exact: true })
      .fill("+639171110004");
    await manualRow
      .getByLabel("Reason for manual delivery", { exact: true })
      .fill("Customer agreed after return inspection");
    await manualRow.getByRole("button", { name: "Assign manual delivery", exact: true }).click();
    await manualRow.getByRole("button", { name: "Hand over packed order", exact: true }).click();
    await manualRow.getByRole("button", { name: "Hand over packed order", exact: true }).click();
    await expect(manualRow).toContainText("Handed over");
    let completedBody: string | null = null;
    let completedKey: string | undefined;
    let completionCalls = 0;
    await admin.route("**/api/admin/manual-deliveries", async (route) => {
      completionCalls++;
      const body = route.request().postData();
      const key = route.request().headers()["idempotency-key"];
      if (completionCalls === 1) {
        completedBody = body;
        completedKey = key;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      } else {
        expect(body).toBe(completedBody);
        expect(key).toBe(completedKey);
        await route.continue();
      }
    });
    await manualRow.getByRole("button", { name: "Record delivered", exact: true }).click();
    // Blank actual cost must remain unknown; the accepted customer charge stays fixed.
    await manualRow.getByRole("button", { name: "Record delivered", exact: true }).click();
    await expect(manualRow).toContainText("The result is unknown");
    await manualRow.getByRole("button", { name: "Retry saved request", exact: true }).click();
    await expect(manualRow).toHaveCount(0);
    expect(completionCalls).toBe(2);
    expect(
      z
        .object({ status: z.literal("DELIVERED") })
        .parse(await read(page, `/api/commerce/orders/${orderId}`)).status,
    ).toBe("DELIVERED");
    // In the combined run, retain and operate the earlier Instant orders after switching.
    const retained = z
      .object({
        items: z.array(
          z.object({
            orderId: z.string(),
            fulfillmentMode: z.string(),
            externalDispatch: z.object({ status: z.string() }).nullable(),
          }),
        ),
      })
      .parse(await read(admin, `/api/admin/delivery?locationId=${locationId}`))
      .items.find(
        (item) => item.fulfillmentMode === "INSTANT" && item.externalDispatch?.status === "ACTIVE",
      );
    if (retained) {
      const retainedRow = admin.getByRole("row").filter({ hasText: retained.orderId });
      admin.once("dialog", (dialog) => dialog.accept());
      await retainedRow.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(retainedRow).toContainText("CANCELED");
      await retainedRow
        .getByRole("button", { name: "Review Lalamove booking", exact: true })
        .click();
      await admin.getByRole("button", { name: "Confirm and book", exact: true }).click();
      await expect(retainedRow).toContainText("Finding rider");
      await testInfo.attach("retained-instant-after-mode-switch", {
        body: "Earlier Instant order remained eligible for its selected courier while new commerce was Scheduled.",
        contentType: "text/plain",
      });
    }
  });
}
