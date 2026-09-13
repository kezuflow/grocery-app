import { expect, test, type Route } from "@playwright/test";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

function address(id: string, label: string) {
  return {
    id,
    label,
    recipient: "Ana",
    phone: "+639171234567",
    components: {
      addressLine1: `${label} address`,
      addressLine2: null,
      barangay: "Luz",
      city: "Cebu City",
      region: "Central Visayas",
      postalCode: "6000",
      countryCode: "PH",
    },
    confirmationSource: "USER_PIN",
    confirmedAt: "2026-08-30T00:00:00.000Z",
    instructions: {
      deliveryInstructions: null,
    },
    latitude: 10.3173,
    longitude: 123.9058,
    serviceable: true,
    serviceabilityReason: null,
    serviceAreaCode: "CEBU_CITY",
    deliveryZoneCode: "CEBU_CITY_CORE",
    resolutionVersion: 1,
    status: "active",
    version: 2,
  } as const;
}

for (const width of [1440, 390]) {
  test(`recovers delivery options and invalidates the quote after address change at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const optionRequests: Record<string, unknown>[] = [];
    const quoteRequests: Record<string, unknown>[] = [];
    const abandoned: string[] = [];
    await page.context().addCookies([
      {
        name: "freshmarkets_browse_point_v2",
        value: encodeURIComponent(JSON.stringify({ latitude: 10.3173, longitude: 123.9058 })),
        url: test.info().project.use.baseURL ?? "http://localhost:3100",
      },
    ]);
    await page.route("**/api/serviceability", (route) =>
      json(route, {
        ok: true,
        value: { serviceable: true, fulfillmentLocation: { id: "test-location" } },
      }),
    );
    await page.route("**/api/commerce/cart", (route) =>
      json(route, {
        ok: true,
        value: {
          id: "cart-fulfillment",
          locationId: "test-location",
          version: 7,
          currency: "PHP",
          totalMinor: 30_000,
          checkoutBlocked: false,
          blockingReasons: [],
          items: [
            {
              skuId: "sku-1",
              quantity: 1,
              name: "Produce box",
              availability: "AVAILABLE",
              unitPriceMinor: 30_000,
              lineTotalMinor: 30_000,
            },
          ],
        },
      }),
    );
    await page.route("**/api/checkout/bootstrap", (route) =>
      json(route, {
        ok: true,
        value: {
          addresses: [address("home", "Home"), address("work", "Work")],
          profile: { accountPhone: null, defaultAddressId: "home" },
        },
      }),
    );
    await page.route("**/api/checkout/fulfillment-options", async (route) => {
      optionRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      if (optionRequests.length === 1) {
        await route.fulfill({
          status: 500,
          body: "Local runtime failed",
          contentType: "text/plain",
        });
        return;
      }
      await json(route, {
        ok: true,
        value: [
          {
            optionId: "fulfillment-instant-opaque",
            mode: "INSTANT",
            eligible: true,
            unavailableReason: null,
            promisedAt: "2026-08-30T17:00:00.000Z",
            deliveryWindow: null,
            feePreview: {
              subtotalMinor: 3_000,
              discountMinor: 0,
              totalMinor: 3_000,
              currency: "PHP",
            },
            cycleId: null,
            cutoffAt: null,
            provisional: true,
          },
          {
            optionId: "fulfillment-scheduled-opaque",
            mode: "SCHEDULED",
            eligible: true,
            unavailableReason: null,
            promisedAt: null,
            deliveryWindow: {
              startsAt: "2026-09-05T00:00:00.000Z",
              endsAt: "2026-09-06T00:00:00.000Z",
            },
            feePreview: {
              subtotalMinor: 2_000,
              discountMinor: 0,
              totalMinor: 2_000,
              currency: "PHP",
            },
            cycleId: "internal-cycle",
            cutoffAt: "2026-09-04T00:00:00.000Z",
            provisional: true,
          },
        ],
      });
    });
    await page.route("**/api/checkout/quote", async (route) => {
      quoteRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      if (quoteRequests.length === 1) {
        await json(route, {
          ok: false,
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Scheduled delivery quotation is unavailable.",
          },
        });
        return;
      }
      await json(route, {
        ok: true,
        value: {
          quoteId: "quote-fulfillment",
          attemptVersion: 1,
          priceAcceptanceVersion: 1,
          expiresAt: "2099-08-30T17:00:00.000Z",
          currency: "PHP",
          merchandiseSubtotalMinor: 30_000,
          itemDiscountMinor: 0,
          orderDiscountMinor: 0,
          deliverySubtotalMinor: 3_000,
          deliveryDiscountMinor: 0,
          taxMinor: 0,
          subtotalMinor: 30_000,
          discountMinor: 0,
          deliveryFeeMinor: 3_000,
          totalMinor: 33_000,
          lines: [],
          requestedPromotionCodes: [],
          promotionFeedback: [],
          promotionApplications: [],
        },
      });
    });
    await page.route("**/api/checkout/quote/*/abandon", async (route) => {
      abandoned.push(route.request().url());
      await json(route, {
        ok: true,
        value: {
          quoteId: "quote-fulfillment",
          outcome: "ABANDONED",
          quoteStatus: "SUPERSEDED",
          releasedInventoryHolds: 1,
        },
      });
    });

    await page.goto("/checkout");
    await expect(page.getByRole("alert")).toContainText("Delivery options could not be loaded");
    await expect(
      page.getByText("Select a confirmed address to load delivery options."),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Retry delivery options" }).click();
    await expect(page.getByRole("button", { name: /Instant delivery/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Scheduled delivery/ })).toBeEnabled();
    await expect(page.getByText(/hub|location-cebu/i)).toHaveCount(0);
    await page.getByRole("button", { name: /Scheduled delivery/ }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Scheduled delivery quotation is unavailable. Retry the delivery quotation.",
    );
    await expect(page.getByRole("button", { name: /Scheduled delivery/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Retry delivery quotation" })).toBeEnabled();
    await page.getByRole("button", { name: "Try quotation again" }).click();
    await expect(page.getByRole("region", { name: "Order total review" })).toContainText("₱330.00");

    await page.screenshot({ path: `test-results/checkout-delivery-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(optionRequests[0]).toEqual({
      addressId: "home",
      addressVersion: 2,
      cartId: "cart-fulfillment",
      cartVersion: 7,
    });
    expect(quoteRequests[1]).toMatchObject({
      addressId: "home",
      fulfillmentOptionId: "fulfillment-scheduled-opaque",
    });
    expect(quoteRequests[1]).not.toHaveProperty("cycleId");

    await page.getByRole("button", { name: "Change saved address" }).click();
    await page.getByRole("radio", { name: /^Work/ }).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => abandoned.length).toBe(1);
    await expect.poll(() => optionRequests.at(-1)?.addressId).toBe("work");
    await expect(page.getByText(/Review your current total/)).toHaveCount(0);
  });
}
