import { createHash } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { test, expect } from "./admin-authenticated-fixture";

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
const reason = "Synthetic Instant booking journey";

for (const width of [1440, 390]) {
  test(`Instant checkout automatically books during packing at ${width}px`, async ({
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
      amountMinor: 100,
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
    if (config.fulfillmentMode !== "INSTANT") {
      await post(admin, "/api/admin/commerce-configuration", {
        action: "SWITCH_MODE",
        fulfillmentMode: "INSTANT",
        cadence: null,
        expectedVersion: config.version,
        reason,
      });
      config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    }
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
      const cart = z
        .object({ id: z.string(), version: z.number() })
        .parse(await read(page, "/api/commerce/cart"));
      await post(page, "/api/commerce/cart", {
        cartId: cart.id,
        expectedVersion: cart.version,
        skuId,
        quantity,
        idempotencyKey: crypto.randomUUID(),
      });
      await page.goto("/checkout");
      await page.getByRole("radio").first().check();
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
      expect(quote.merchandiseSubtotalMinor).toBe(quantity * 100);
      await page.getByRole("region", { name: "Order total review" }).screenshot({
        path: testInfo.outputPath(`checkout-delivery-policy-${width}.png`),
      });
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
    expect(product.inventoryPool.position?.availableBase ?? 0).toBeGreaterThanOrEqual(1000);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /trial|membership/i })).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "FreshMarkets membership offer" }),
    ).toHaveCount(0);
    const retired = await page.request.post("/api/membership/enroll", {
      data: { offerId: "offer-membership-monthly" },
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    expect(await retired.json()).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    const orderId = await checkout(2);
    const deliverySchema = z.object({
      items: z.array(
        z.object({
          orderId: z.string(),
          jobId: z.string(),
          status: z.string(),
          version: z.number(),
          externalDispatch: z
            .object({ dispatchId: z.string(), status: z.string(), version: z.number() })
            .nullable(),
        }),
      ),
    });
    async function delivery() {
      const item = deliverySchema
        .parse(await read(admin, `/api/admin/delivery?locationId=${locationId}&limit=100`))
        .items.find((item) => item.orderId === orderId);
      if (!item) throw new Error("Missing delivery job");
      return item;
    }
    expect((await delivery()).externalDispatch).toBeNull();
    await admin.goto("/admin/fulfillment");
    await admin.getByRole("combobox", { name: "Active admin scope" }).click();
    await admin.getByRole("option", { name: "Central Cebu", exact: true }).click();
    const row = admin.getByRole("row").filter({ hasText: orderId });
    await row.getByRole("button", { name: "Accept order & start picking", exact: true }).click();
    expect((await delivery()).externalDispatch).toBeNull();
    await row.getByRole("button", { name: "Finish picking", exact: true }).click();
    expect((await delivery()).externalDispatch).toBeNull();
    await row.getByRole("button", { name: "Start packing", exact: true }).click();
    await expect(row).toContainText("PACKING");
    const booked = await delivery();
    expect(booked.externalDispatch).toMatchObject({ status: "ACTIVE" });
    expect(booked.status).toBe("UNASSIGNED");
    expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
    expect((await delivery()).externalDispatch?.dispatchId).toBe(
      booked.externalDispatch?.dispatchId,
    );
    await row.getByRole("button", { name: "Finish packing", exact: true }).click();
    await expect(row).toContainText("PACKED");
    expect((await delivery()).externalDispatch?.dispatchId).toBe(
      booked.externalDispatch?.dispatchId,
    );
    await admin.goto("/admin/delivery");
    await expect(admin.getByRole("row").filter({ hasText: orderId })).toContainText(
      "Finding rider",
    );
    const courierRow = admin.getByRole("row").filter({ hasText: orderId });
    admin.once("dialog", (dialog) => dialog.accept());
    await courierRow.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(courierRow).toContainText("CANCELED");
    await courierRow.getByRole("button", { name: "Review Lalamove booking", exact: true }).click();
    await admin.getByRole("button", { name: "Confirm and book", exact: true }).click();
    await expect(courierRow).toContainText("Finding rider");
    const retried = await delivery();
    expect(retried.externalDispatch?.dispatchId).not.toBe(booked.externalDispatch?.dispatchId);
    expect(retried.externalDispatch?.status).toBe("ACTIVE");
    expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
    expect((await delivery()).externalDispatch?.dispatchId).toBe(
      retried.externalDispatch?.dispatchId,
    );
    await admin.screenshot({
      path: testInfo.outputPath(`instant-auto-booking-${width}.png`),
      fullPage: true,
    });
  });
}
