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
            deliveryPartner: {
              code: "lalamove",
              displayName: "Lalamove",
              serviceType: "MOTORCYCLE",
              serviceLabel: "Motorcycle",
            },
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
            message: "Lalamove quotation is temporarily unavailable.",
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
    await expect(page.getByRole("radio", { name: /Lalamove/ })).toBeEnabled();
    await expect(page.getByRole("radio", { name: /Lalamove/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByRole("radiogroup", { name: "Delivery option" }).getByText(/Scheduled delivery/),
    ).toHaveCount(0);
    await expect(page.getByText(/hub|location-cebu/i)).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText(
      "Lalamove quotation is temporarily unavailable. Retry the delivery quotation.",
    );
    await page.getByRole("button", { name: "Try quotation again" }).click();
    await expect(page.getByRole("complementary", { name: "Order summary" })).toContainText(
      "₱330.00",
    );
    await expect(page.getByRole("button", { name: "Continue to payment" })).toBeEnabled();

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
      fulfillmentOptionId: "fulfillment-instant-opaque",
    });
    expect(quoteRequests[1]).not.toHaveProperty("cycleId");

    await page.getByRole("radio", { name: /^Work/ }).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => abandoned.length).toBe(1);
    await expect.poll(() => optionRequests.at(-1)?.addressId).toBe("work");
    await expect(page.getByText(/Payment review/)).toHaveCount(0);
  });
}

test("quotes the current Scheduled delivery option and keeps the cutoff notice visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let quotedOptionId: string | undefined;
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
        id: "cart-scheduled",
        locationId: "test-location",
        version: 8,
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
        addresses: [address("home", "Home")],
        profile: { accountPhone: null, defaultAddressId: "home" },
      },
    }),
  );
  await page.route("**/api/checkout/fulfillment-options", (route) =>
    json(route, {
      ok: true,
      value: [
        {
          optionId: "fulfillment-scheduled-opaque",
          mode: "SCHEDULED",
          eligible: true,
          unavailableReason: null,
          deliveryPartner: {
            code: "lalamove",
            displayName: "Lalamove",
            serviceType: "MOTORCYCLE",
            serviceLabel: "Motorcycle",
          },
          promisedAt: null,
          deliveryWindow: {
            windowId: "window-weekend",
            name: "Weekend delivery",
            startsAt: "2099-09-26T01:00:00.000Z",
            endsAt: "2099-09-27T04:00:00.000Z",
          },
          feePreview: null,
          cycleId: "cycle-weekend",
          cutoffAt: "2099-09-25T04:00:00.000Z",
          provisional: true,
        },
      ],
    }),
  );
  await page.route("**/api/checkout/quote", async (route) => {
    quotedOptionId = (route.request().postDataJSON() as { fulfillmentOptionId?: string })
      .fulfillmentOptionId;
    await json(route, {
      ok: true,
      value: {
        quoteId: "quote-scheduled",
        attemptVersion: 1,
        priceAcceptanceVersion: 1,
        expiresAt: "2099-09-25T05:00:00.000Z",
        currency: "PHP",
        merchandiseSubtotalMinor: 30_000,
        itemDiscountMinor: 0,
        orderDiscountMinor: 0,
        deliverySubtotalMinor: 2_500,
        deliveryDiscountMinor: 0,
        taxMinor: 0,
        subtotalMinor: 30_000,
        discountMinor: 0,
        deliveryFeeMinor: 2_500,
        totalMinor: 32_500,
        lines: [],
        requestedPromotionCodes: [],
        promotionFeedback: [],
        promotionApplications: [],
      },
    });
  });

  await page.goto("/checkout");
  await expect(page.getByRole("radio", { name: /Lalamove/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText("Order cutoff", { exact: false })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Order summary" })).toContainText("₱325.00");
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  const cutoffNotice = page.getByRole("complementary", { name: "Scheduled delivery cutoff" });
  await expect(cutoffNotice).toContainText("Friday, 12:00 PM");
  await expect(cutoffNotice).toContainText("following Saturday or Sunday");
  expect(await cutoffNotice.evaluate((element) => getComputedStyle(element).position)).toBe(
    "fixed",
  );
  expect(quotedOptionId).toBe("fulfillment-scheduled-opaque");
});
