import { expect, test, type Page, type Route } from "@playwright/test";

const candidate = {
  candidateKey: "temporary-candidate",
  displayAddress: "Ayala Center Cebu, Cebu City 6000, Philippines",
  coordinate: { latitude: 10.3173, longitude: 123.9058 },
  components: {
    addressLine1: "Ayala Center Cebu",
    addressLine2: null,
    barangay: "Luz",
    city: "Cebu City",
    region: "Central Visayas",
    postalCode: "6000",
    countryCode: "PH",
  },
  accuracy: "rooftop",
} as const;

const serviceability = {
  serviceable: true,
  reason: null,
  coordinate: candidate.coordinate,
  market: {
    code: "METRO_CEBU",
    name: "Metro Cebu",
    currency: "PHP",
    timezone: "Asia/Manila",
  },
  serviceArea: { code: "CEBU_CITY", name: "Cebu City", polygonVersion: 1 },
  deliveryZone: { code: "CEBU_CITY_CORE", name: "Cebu City Core", polygonVersion: 1 },
  fulfillmentEligibility: { eligible: true, candidateCount: 1 },
  resolutionChanged: false,
  evaluatedAt: "2026-08-30T00:00:00.000Z",
} as const;

function address(id: string, label: string, available: boolean) {
  return {
    id,
    label,
    recipient: "Ana Santos",
    phone: "+639171234567",
    components: candidate.components,
    confirmationSource: "GEOCODER",
    confirmedAt: "2026-08-30T00:00:00.000Z",
    instructions: {
      buildingUnit: null,
      landmark: "Main entrance",
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    },
    latitude: candidate.coordinate.latitude,
    longitude: candidate.coordinate.longitude,
    serviceable: available,
    serviceabilityReason: available ? null : "OUTSIDE_SERVICE_AREA",
    serviceAreaCode: available ? "CEBU_CITY" : null,
    deliveryZoneCode: available ? "CEBU_CITY_CORE" : null,
    resolutionVersion: 1,
    status: "active",
    version: 2,
  };
}

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function assertNoCoordinateInputs(page: Page) {
  await expect(page.locator('input[name="latitude"]')).toHaveCount(0);
  await expect(page.locator('input[name="longitude"]')).toHaveCount(0);
  await expect(page.getByLabel("Latitude", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Longitude", { exact: true })).toHaveCount(0);
}

test("searches, confirms, and saves an address from the address book with map fallback", async ({
  page,
}) => {
  let savedAddresses: ReadonlyArray<ReturnType<typeof address>> = [];
  let searchRequest: Record<string, unknown> | undefined;
  let updateRequest: Record<string, unknown> | undefined;
  await page.route("**/api/commerce/address-search", async (route) => {
    searchRequest = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, { ok: true, value: [candidate], requestId: "search-1" });
  });
  await page.route("**/api/serviceability", async (route) => {
    await json(route, { ok: true, value: serviceability, requestId: "serviceability-1" });
  });
  await page.route("**/api/commerce/address", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { ok: true, value: savedAddresses, requestId: "addresses-1" });
      return;
    }
    if (route.request().method() === "PATCH") {
      updateRequest = route.request().postDataJSON() as Record<string, unknown>;
      const updated = {
        ...(savedAddresses[0] ?? address("address-home", "Home", true)),
        recipient: String(updateRequest.recipient),
        version: 3,
      };
      savedAddresses = [updated];
      await json(route, { ok: true, value: updated, requestId: "address-update-1" });
      return;
    }
    const saved = address("address-home", "Home", true);
    savedAddresses = [saved];
    await json(route, { ok: true, value: saved, requestId: "address-save-1" });
  });

  await page.goto("/account/addresses");
  await expect(page.getByRole("heading", { name: "Delivery addresses" })).toBeVisible();
  await expect(page.getByText("No saved delivery addresses yet")).toBeVisible();
  await assertNoCoordinateInputs(page);

  await page.getByLabel("Search for an address").fill("Ayala Cebu");
  await page.getByRole("button", { name: candidate.displayAddress }).click();
  await expect(page.getByText("Delivery is available", { exact: true })).toBeVisible();
  await expect(page.getByText(/You can still choose a search result/)).toBeVisible();
  await page.getByLabel("Address label").fill("Home");
  await page.getByLabel("Recipient name").fill("Ana Santos");
  await page.getByLabel("Phone number").fill("+639171234567");
  await page.getByRole("button", { name: "Save confirmed address" }).click();

  await expect(page.getByRole("radio", { name: /Home/ })).toBeEnabled();
  expect(searchRequest).toEqual({ query: "Ayala Cebu" });
  expect(searchRequest).not.toHaveProperty("latitude");
  expect(searchRequest).not.toHaveProperty("longitude");

  await page.getByRole("button", { name: "Edit Home address" }).click();
  await page.getByLabel("Recipient name").fill("Bea Santos");
  await page.getByRole("button", { name: "Update confirmed address" }).click();
  await expect(page.getByRole("radio", { name: /Bea Santos/ })).toBeEnabled();
  expect(updateRequest).toMatchObject({
    addressId: "address-home",
    expectedVersion: 2,
    recipient: "Bea Santos",
  });
});

test("shows an unavailable saved address and opens correction without making it selectable", async ({
  page,
}) => {
  const unavailable = address("address-parents", "Parents", false);
  await page.route("**/api/commerce/address", async (route) => {
    await json(route, { ok: true, value: [unavailable], requestId: "addresses-unavailable" });
  });

  await page.goto("/account/addresses");
  await expect(page.getByText("Delivery unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Parents/ })).toBeDisabled();
  await page.getByRole("button", { name: "Correct Parents address" }).click();
  await expect(page.getByRole("form", { name: "Delivery address editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update confirmed address" })).toBeVisible();
  await assertNoCoordinateInputs(page);
});

test("checkout sends only a selected serviceable saved address to Core eligibility", async ({
  page,
}) => {
  const home = address("address-home", "Home", true);
  const unavailable = address("address-unavailable", "Outside Cebu", false);
  let optionAddressId: string | undefined;
  await page.route("**/api/commerce/cart", (route) =>
    json(route, {
      ok: true,
      value: {
        id: "cart-1",
        version: 4,
        items: [
          {
            skuId: "sku-1",
            quantity: 1,
            name: "Fresh produce",
            unitPriceMinor: 30000,
            lineTotalMinor: 30000,
          },
        ],
        totalMinor: 30000,
        currency: "PHP",
      },
      requestId: "cart-1",
    }),
  );
  await page.route("**/api/checkout/fulfillment-options", async (route) => {
    optionAddressId = (route.request().postDataJSON() as { addressId?: string }).addressId;
    await json(route, {
      ok: true,
      value: [
        {
          optionId: "fulfillment-scheduled-1",
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
          cycleId: "cycle-1",
          cutoffAt: "2026-09-04T00:00:00.000Z",
          provisional: true,
        },
      ],
      requestId: "options-1",
    });
  });
  await page.route("**/api/commerce/address", (route) =>
    json(route, { ok: true, value: [home, unavailable], requestId: "addresses-checkout" }),
  );
  await page.route("**/api/checkout/quote", (route) =>
    json(route, {
      ok: true,
      value: {
        quoteId: "quote-1",
        attemptVersion: 1,
        priceAcceptanceVersion: 1,
        expiresAt: "2026-09-05T00:00:00.000Z",
        currency: "PHP",
        merchandiseSubtotalMinor: 30_000,
        itemDiscountMinor: 0,
        orderDiscountMinor: 0,
        deliverySubtotalMinor: 2_000,
        deliveryDiscountMinor: 0,
        serviceFeeMinor: 0,
        taxMinor: 0,
        subtotalMinor: 30_000,
        discountMinor: 0,
        deliveryFeeMinor: 2_000,
        totalMinor: 32_000,
        lines: [],
        requestedPromotionCodes: [],
        promotionFeedback: [],
        promotionApplications: [],
      },
      requestId: "quote-1",
    }),
  );

  await page.goto("/checkout");
  await expect(page.getByRole("radio", { name: /Home/ })).toBeEnabled();
  await expect(page.getByRole("radio", { name: /Outside Cebu/ })).toBeDisabled();
  await assertNoCoordinateInputs(page);
  await page.getByRole("radio", { name: /Home/ }).check();
  await page.getByRole("button", { name: /Scheduled delivery/ }).click();
  await expect(page.getByText("Review your current total: PHP 320.00.")).toBeVisible();
  expect(optionAddressId).toBe("address-home");
});

test("public serviceability checks a confirmed search result without saving or showing hubs", async ({
  page,
}) => {
  let saveCalls = 0;
  await page.route("**/api/commerce/address-search", (route) =>
    json(route, { ok: true, value: [candidate], requestId: "public-search" }),
  );
  await page.route("**/api/serviceability", (route) =>
    json(route, { ok: true, value: serviceability, requestId: "public-serviceability" }),
  );
  await page.route("**/api/commerce/address", async (route) => {
    saveCalls += 1;
    await json(route, { ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
  });

  await page.goto("/serviceability");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Search for an address").fill("Ayala Cebu");
  await page.getByRole("button", { name: candidate.displayAddress }).click();
  await expect(page.getByText("Delivery is available", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);
  await expect(page.getByText(/fulfillment hub/i)).toHaveCount(0);
  await expect(page.getByText(/operations location/i)).toHaveCount(0);
  await assertNoCoordinateInputs(page);
  expect(saveCalls).toBe(0);
});

test("storefront delivery control opens the address flow and keeps the confirmed browsing location", async ({
  page,
}) => {
  await page.route("**/api/commerce/address-search", (route) =>
    json(route, { ok: true, value: [candidate], requestId: "header-search" }),
  );
  await page.route("**/api/serviceability", (route) =>
    json(route, { ok: true, value: serviceability, requestId: "header-serviceability" }),
  );

  await page.goto("/");
  const deliveryControl = page.getByRole("button", { name: "Choose delivery address" });
  await deliveryControl.click();
  const dialog = page.getByRole("dialog", { name: "Choose delivery address" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Search for an address").fill("Ayala Cebu");
  await dialog.getByRole("button", { name: candidate.displayAddress }).click();
  await expect(dialog.getByText("Delivery is available", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Deliver here" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(deliveryControl).toContainText("Ayala Center Cebu");
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose delivery address" })).toContainText(
    "Ayala Center Cebu",
  );
});

test("anonymous serviceability reaches Core through the real Web Service Binding", async ({
  request,
}) => {
  const response = await request.post("/api/serviceability", {
    data: candidate.coordinate,
  });
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    value: { coordinate: candidate.coordinate },
  });
});
