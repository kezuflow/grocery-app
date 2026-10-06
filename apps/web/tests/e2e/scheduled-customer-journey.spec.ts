import { createHash } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { test, expect, executeAdminE2eSql, queryAdminE2eSql } from "./admin-authenticated-fixture";
import { completeLocalCourierDelivery } from "./signed-delivery-events";
import { completeLocalManualDelivery } from "./manual-delivery-journey";
import { confirmLocalRefund, cancelLocalPaidOrder } from "./signed-refund-events";

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

const scheduledCases = [1440, 390].flatMap((width) =>
  ["courier", "manual", "late-capture", "cancel"].map((dispatch) => ({ width, dispatch })),
);
for (const { width, dispatch } of scheduledCases) {
  const journey =
    dispatch === "late-capture"
      ? "late capture and full refund without an Order"
      : dispatch === "cancel"
        ? "paid Order cancellation and full refund"
        : `paid Order, week purchase, packing and ${dispatch} delivery`;
  test(`Scheduled ${journey} at ${width}px`, async ({
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
            .object({
              onHandBase: z.number(),
              reservedBase: z.number(),
              availableBase: z.number(),
            })
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
    // Close previous disposable scenarios through ordinary commands: Core offers the earliest open week.
    const previousCycles =
      z
        .array(z.object({ results: z.array(z.object({ id: z.string(), version: z.number() })) }))
        .parse(
          queryAdminE2eSql(
            "SELECT id,version FROM delivery_cycle WHERE status='OPEN' AND market_id='market-metro-cebu'",
          ),
        )[0]?.results ?? [];
    for (const previous of previousCycles)
      await post(admin, "/api/admin/delivery-cycles", {
        action: "CLOSE_ORDERING",
        cycleId: previous.id,
        expectedVersion: previous.version,
        reason: "Isolate disposable acceptance week",
      });
    const cutoff = Date.now() + 5 * 60_000,
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
        procurementAt: at(60 * 60_000),
        preparationAt: at(61 * 60_000),
        pickupAt: at(2 * 60 * 60_000),
        windows: [
          { name: "Afternoon", startsAt: at(2 * 60 * 60_000), endsAt: at(3 * 60 * 60_000) },
        ],
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
    const journeyAddress = z.object({ id: z.string(), version: z.number() }).parse(
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
          deliveryInstructions: null,
        },
      }),
    );
    // The provider-hosted page is the sole browser response fake. It has no
    // financial-success authority; signed events go to the actual Core webhook.
    await page.route("**/development/mock-payments/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Test payment provider</h1>" }),
    );
    let captured: { intentId: string; reference: string; amountMinor: number } | null = null;
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
      const applied = await value(
        await page.request.post("/webhooks/payments/mock", { data: body, headers }),
      );
      expect(applied).toMatchObject({ processingStatus: "APPLIED" });
      captured = {
        intentId: z.object({ paymentIntentId: z.string() }).parse(applied).paymentIntentId,
        reference,
        amountMinor,
      };
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
      const currentCart = z.object({ id: z.string(), version: z.number() }).parse(
        await post(page, "/api/commerce/cart", {
          cartId: cart.id,
          expectedVersion: cart.version,
          skuId,
          quantity,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      const options = z
        .array(
          z.object({
            optionId: z.string(),
            mode: z.string(),
            cycleId: z.string().nullable(),
            eligible: z.boolean(),
          }),
        )
        .parse(
          await post(page, "/api/checkout/fulfillment-options", {
            addressId: journeyAddress.id,
            addressVersion: journeyAddress.version,
            cartId: currentCart.id,
            cartVersion: currentCart.version,
          }),
        );
      const scheduledOption = options.find(
        (option) =>
          option.mode === "SCHEDULED" && option.eligible && option.cycleId === cycle.cycleId,
      );
      if (!scheduledOption) throw new Error("Missing retained Scheduled fulfillment option");
      const quote = z
        .object({
          quoteId: z.string(),
          attemptVersion: z.number(),
          priceAcceptanceVersion: z.number(),
          currency: z.string(),
          merchandiseSubtotalMinor: z.number(),
          itemDiscountMinor: z.number(),
          orderDiscountMinor: z.number(),
          deliverySubtotalMinor: z.number(),
          deliveryFeeMinor: z.number(),
          deliveryDiscountMinor: z.number(),
          taxMinor: z.number(),
          totalMinor: z.number(),
        })
        .parse(
          await post(page, "/api/checkout/quote", {
            cartId: currentCart.id,
            cartVersion: currentCart.version,
            addressId: journeyAddress.id,
            fulfillmentOptionId: scheduledOption.optionId,
            promotionCodes: [],
          }),
        );
      expect(quote.merchandiseSubtotalMinor).toBe(quantity * 100000);
      const payment = z
        .object({ actionType: z.literal("REDIRECT"), redirectUrl: z.string().url() })
        .parse(
          await post(page, "/api/checkout/payment", {
            checkoutAttemptId: quote.quoteId,
            expectedQuoteVersion: quote.attemptVersion,
            expectedPriceAcceptanceVersion: quote.priceAcceptanceVersion,
            expectedCurrency: quote.currency,
            expectedMerchandiseSubtotalMinor: quote.merchandiseSubtotalMinor,
            expectedItemDiscountMinor: quote.itemDiscountMinor,
            expectedOrderDiscountMinor: quote.orderDiscountMinor,
            expectedDeliverySubtotalMinor: quote.deliverySubtotalMinor,
            expectedDeliveryFeeMinor: quote.deliveryFeeMinor,
            expectedDeliveryDiscountMinor: quote.deliveryDiscountMinor,
            expectedTaxMinor: quote.taxMinor,
            expectedTotalMinor: quote.totalMinor,
            paymentMethod: { kind: "TOKEN", value: "qrph" },
            returnUrl: new URL(
              "/orders",
              testInfo.project.use.baseURL ?? "http://localhost:3100",
            ).toString(),
          }),
        );
      await page.goto(payment.redirectUrl);
      await expect(page).toHaveURL(/\/development\/mock-payments\//);
      expect(orders.parse(await read(page, "/api/commerce/orders")).items).toEqual(before.items);
      if (dispatch === "late-capture") {
        // Move only the selected disposable cycle's schedule, then let the real cron freeze demand.
        const past = Date.now() - 2 * 60 * 60_000;
        executeAdminE2eSql(
          `UPDATE delivery_cycle SET cutoff_at=${past},version=version+1 WHERE id='${cycle.cycleId}'; UPDATE delivery_cycle_schedule SET procurement_at=${past + 60 * 60_000} WHERE cycle_id='${cycle.cycleId}';`,
        );
        expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
      }
      await confirmTestPayment(quote.totalMinor);
      const current = orders.parse(await read(page, "/api/commerce/orders"));
      const created = current.items.filter(
        (item) => !before.items.some((old) => old.id === item.id),
      );
      if (dispatch === "late-capture") {
        expect(created).toHaveLength(0);
        if (!captured) throw new Error("Missing captured-money observation");
        await confirmLocalRefund(page, captured.intentId, captured.reference, quote.totalMinor);
        expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
        executeAdminE2eSql(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
            EXISTS(SELECT 1 FROM order_payment_reaction WHERE payment_intent_id='${captured.intentId}') OR
            EXISTS(SELECT 1 FROM committed_demand WHERE delivery_cycle_id='${cycle.cycleId}');`);
        return null;
      }
      expect(created).toHaveLength(1);
      const order = created[0];
      if (!order) throw new Error("Missing committed Order");
      return order.id;
    }
    const orderId = await checkout(2);
    if (dispatch === "late-capture") {
      expect(orderId).toBeNull();
      return;
    }
    if (!orderId) throw new Error("Missing committed Order");
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByRole("region", { name: "Add items before cutoff" })).toHaveCount(0);
    const detail = z
      .object({ version: z.number(), status: z.string() })
      .parse(await read(page, `/api/commerce/orders/${orderId}`));
    expect(detail.status).toBe("COMMITTED");
    const rejectedAddition = await page.request.post(`/api/commerce/orders/${orderId}/amendments`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { expectedOrderVersion: detail.version, additions: [{ skuId, quantity: 1 }] },
    });
    expect(await rejectedAddition.json()).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });

    if (dispatch === "cancel") {
      const payment = captured as {
        intentId: string;
        reference: string;
        amountMinor: number;
      } | null;
      if (!payment) throw new Error("Missing captured-money observation");
      await cancelLocalPaidOrder(page, orderId, payment);
      return;
    }

    // Advance only the local E2E cycle clock; all customer and staff actions
    // above and below still use their real Web -> Core -> D1 command paths.
    const pastCutoff = Date.now() - 2 * 60 * 60_000;
    executeAdminE2eSql(
      `UPDATE delivery_cycle SET cutoff_at=${pastCutoff},version=version+1 WHERE id='${cycle.cycleId}' AND status='OPEN'; UPDATE delivery_cycle_schedule SET procurement_at=${pastCutoff + 60 * 60_000} WHERE cycle_id='${cycle.cycleId}';`,
    );
    expect((await admin.request.post("/__e2e/scheduled")).status()).toBe(204);
    await admin.goto("/admin/procurement");
    await admin.getByRole("combobox", { name: "Active admin scope" }).click();
    await admin.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await admin
      .getByRole("combobox", { name: "Delivery week", exact: true })
      .selectOption(cycle.cycleId);
    await admin.getByRole("tab", { name: "Quantities to buy", exact: true }).click();
    await expect(admin.getByRole("table", { name: "Paid quantities to buy" })).toContainText(
      "1,000 g",
    );
    await expect(admin.getByRole("button", { name: "Confirm purchase", exact: true })).toHaveCount(
      0,
    );
    await admin.getByRole("button", { name: "Purchase complete", exact: true }).click();
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm purchase complete" })
      .click();
    await expect(admin.getByText("Purchase completed", { exact: false })).toBeVisible();
    await admin.goto(`/admin/fulfillment?orderId=${orderId}`);
    await admin.getByRole("button", { name: "Finish packing order", exact: true }).click();
    await admin
      .getByRole("alertdialog", { name: "Confirm this Order is packed accurately" })
      .getByRole("button", { name: "Confirm packed accurately", exact: true })
      .click();
    await expect(admin.getByText("Order packed", { exact: false })).toBeVisible();

    expect(
      z.object({ status: z.string() }).parse(await read(page, `/api/commerce/orders/${orderId}`))
        .status,
    ).toBe("FULFILLMENT_READY");
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText("Packed", { exact: true })).toBeVisible();
    const stockAfterPacking = z
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
      );
    expect(stockAfterPacking.inventoryPool.position).toEqual(product.inventoryPool.position);
    expect(
      await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await admin.goto("/admin/delivery");
    const row = admin.getByRole("row").filter({ hasText: orderId });
    if (dispatch === "manual") await completeLocalManualDelivery(admin, page, orderId);
    else {
      await row.getByRole("button", { name: "Request Lalamove", exact: true }).click();
      await row.getByRole("button", { name: "Review Lalamove booking", exact: true }).click();
      await admin
        .getByRole("alertdialog", { name: "Confirm Lalamove booking" })
        .getByRole("button", { name: "Confirm and book", exact: true })
        .click();
      await expect(row).toContainText("Finding rider");
      await completeLocalCourierDelivery(admin, page, orderId, locationId);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
