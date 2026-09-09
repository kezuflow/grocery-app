import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

for (const width of [1440, 390])
  test(`releases an Instant checkout after a lost response at ${width}px`, async ({
    signedInPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    // Operational readiness and stock are isolated setup; cart, address, quote and release use Web/Core.
    executeAdminE2eSql(`
      UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='INSTANT',cadence=NULL,version=version+1 WHERE id='global';
      UPDATE fulfillment_location_readiness SET instant_promise_minutes=90,max_concurrent_instant_orders=25,dispatch_ready=1,version=version+1 WHERE location_id='location-cebu-central';
      UPDATE inventory_balance SET on_hand=100000 WHERE inventory_pool_id='pool-red-onion' AND location_id='location-cebu-central';
      INSERT OR IGNORE INTO fulfillment_location_delivery_profile(location_id,sender_name,phone_e164,formatted_address,address_line1,city,country_code,version,created_at,updated_at)
      VALUES ('location-cebu-central','Test pickup','+639171234567','Test pickup, Cebu City','Test pickup','Cebu City','PH',1,1,1);
    `);
    const cart = await (await page.request.get("/api/commerce/cart")).json();
    expect(cart).toMatchObject({ ok: true });
    const item = await page.request.post("/api/commerce/cart", {
      data: {
        cartId: cart.value.id,
        expectedVersion: cart.value.version,
        skuId: "sku-red-onion-500g",
        quantity: 10,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(await item.json()).toMatchObject({ ok: true });
    const address = await page.request.post("/api/commerce/address", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        label: "Checkout home",
        recipient: "Test Customer",
        phone: "+639171234567",
        components: {
          addressLine1: "Test destination",
          addressLine2: null,
          barangay: "Luz",
          city: "Cebu City",
          region: "Central Visayas",
          postalCode: "6000",
          countryCode: "PH",
        },
        componentsSource: "FIRST_PARTY",
        latitude: 10.3173,
        longitude: 123.9058,
        confirmationSource: "USER_PIN",
        instructions: {
          buildingUnit: null,
          landmark: null,
          gateGuard: null,
          deliveryNote: null,
          recipientInstruction: null,
        },
      },
    });
    expect(await address.json()).toMatchObject({ ok: true });
    await page.goto("/checkout");
    await page.getByRole("radio", { name: /Checkout home/ }).check();
    await page
      .getByRole("group", { name: "Fulfillment option", exact: true })
      .getByRole("button")
      .click();
    await expect(page.getByRole("heading", { name: "Payment review" })).toBeVisible();
    const requests: Array<{ body: string | null; key: string | undefined }> = [];
    await page.route("**/api/checkout/quote/*/abandon", async (route) => {
      requests.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({
        ok: true,
        value: { releasedInventoryHolds: 1 },
      });
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Discard current total and start again" }).click();
    await expect(page.getByText(/could not be released safely/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment review" })).toBeVisible();
    await page.getByRole("button", { name: "Discard current total and start again" }).click();
    await expect(
      page.getByText("Current checkout released. You can choose new delivery details."),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect(page.getByRole("heading", { name: "Payment review" })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("checkout-abandonment.png"),
      fullPage: true,
    });
  });
