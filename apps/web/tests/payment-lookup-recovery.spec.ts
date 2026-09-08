import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

// Pending financial state is a fixture seam; recheck acceptance/replay use real Web/Core/D1.
for (const width of [1440, 390])
  test(`Recover a queued payment check at ${width}px`, async ({ adminPage: page }, testInfo) => {
    test.setTimeout(60_000);
    const suffix = crypto.randomUUID();
    const now = Date.now();
    const userId = `payment-user-${suffix}`;
    const principalId = `payment-principal-${suffix}`;
    const customerId = `payment-customer-${suffix}`;
    const paymentIntentId = `payment-intent-${suffix}`;
    executeAdminE2eSql(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${userId}', 'Payment Customer', 'payment-${suffix}@example.com', 1, ${now}, ${now});
    INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at)
      VALUES ('${principalId}', '${userId}', 'active', ${now}, ${now});
    INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at)
      VALUES ('${customerId}', '${userId}', '${principalId}', 'active', 1, ${now}, ${now});
    INSERT INTO payment_intent
      (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status,
       idempotency_key, version, created_at, updated_at)
      VALUES ('${paymentIntentId}', 'GROCERY_CHECKOUT', 'checkout_quote', 'quote-${suffix}',
              '${customerId}', 12500, 'PHP', 'PROCESSING', 'intent-${suffix}', 1, ${now}, ${now});
    INSERT INTO payment_attempt (id, customer_id, payment_intent_id, provider_reference, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at)
      VALUES ('attempt-${suffix}', '${customerId}', '${paymentIntentId}', 'mock-captured-${suffix}', 12500, 'PHP', 'PROCESSING', 'mock', 'attempt-key-${suffix}', ${now}, ${now});
  `);

    if (width === 390)
      executeAdminE2eSql(
        `INSERT INTO payment_lookup_recovery(payment_intent_id,status,attempts,available_at,last_error_code,version,created_at,updated_at) VALUES ('${paymentIntentId}','EXHAUSTED',5,${now},'PROVIDER_LOOKUP_UNRESOLVED',1,${now},${now});`,
      );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/admin/payments/transactions/${paymentIntentId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: `Payment ${paymentIntentId}` }),
    ).toBeVisible({ timeout: 15_000 });
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Payment status recovery", exact: true }) });
    if (width === 390) await expect(section.getByText(/Automatic checks stopped/)).toBeVisible();
    const writes: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/payments/recheck", async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (writes.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await section
      .getByLabel("Provider check reason")
      .fill("Verify payment after interrupted checkout");
    await section.getByRole("button", { name: "Check provider status", exact: true }).click();
    await expect(section.getByText(/The response is unknown/)).toBeVisible();
    await expect(section.getByLabel("Provider check reason")).toBeDisabled();
    await section.getByRole("button", { name: "Retry saved provider check" }).click();
    await expect(section.getByText(/Provider check queued/)).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(JSON.parse(writes[0].body ?? "{}")).toMatchObject({
      paymentIntentId,
      expectedVersion: 1,
      expectedRecoveryVersion: width === 390 ? 1 : 0,
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: `Payment ${paymentIntentId}` }),
    ).toBeVisible({ timeout: 15000 });
    await expect(section.getByText(/Next check/)).toBeVisible();
    await expect(page.getByText("PAYMENT.LOOKUP_RECHECK_REQUESTED", { exact: false })).toHaveCount(
      1,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("payment-lookup.png"), fullPage: true });
  });
