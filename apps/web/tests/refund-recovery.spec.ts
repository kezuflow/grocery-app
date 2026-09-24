import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

// Captured-payment linkage is fixture evidence; refund admission/submission/replay use real Web/Core with the test-only provider.
for (const width of [1440, 390])
  test(`Recover a submitted refund at ${width}px`, async ({ adminPage: page }, testInfo) => {
    test.setTimeout(120_000);
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
              '${customerId}', 12500, 'PHP', 'SUCCEEDED', 'intent-${suffix}', 1, ${now}, ${now});
    INSERT INTO payment_attempt (id, customer_id, payment_intent_id, provider_reference, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at)
      VALUES ('attempt-${suffix}', '${customerId}', '${paymentIntentId}', 'mock-captured-${suffix}', 12500, 'PHP', 'SUCCEEDED', 'mock', 'attempt-key-${suffix}', ${now}, ${now});
  `);

    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/admin/payments/transactions/${paymentIntentId}`);
    await expect(page.getByRole("heading", { name: paymentIntentId, exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("Refund amount").fill("25.001");
    await page.getByRole("button", { name: "Refund", exact: true }).click();
    await page.getByLabel("Confirmation reason").fill("Inspected quality issue");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByText(/Enter a valid amount within the remaining refundable balance/),
    ).toBeVisible();
    await page.getByLabel("Refund amount").fill("25.01");
    const writes: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/payments/refunds", async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (writes.length === 3) return route.abort("failed");
      if (writes.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Refund", exact: true }).click();
    await page.getByLabel("Confirmation reason").fill("Inspected quality issue");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByText(/The response is unknown\. Retry the saved refund request/u),
    ).toBeVisible();
    await expect(page.getByLabel("Refund amount")).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved command" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Refund request accepted" }),
    ).toBeVisible({ timeout: 15_000 });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(JSON.parse(writes[0].body ?? "{}")).toMatchObject({
      amountMinor: 2501,
      expectedVersion: 1,
      reason: "Inspected quality issue",
    });
    if (width === 1440) {
      await page.getByLabel("Refund amount").fill("10.00");
      await page.getByRole("button", { name: "Refund", exact: true }).click();
      await page.getByLabel("Confirmation reason").fill("Separate later refund intent");
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect.poll(() => writes.length).toBe(3);
      expect(writes[2].key).not.toBe(writes[0].key);
      await expect(
        page.getByText(/The response is unknown\. Retry the saved refund request/u),
      ).toBeVisible();
    }
    executeAdminE2eSql(
      `UPDATE payment_refund SET status='ESCALATED', last_error_code='PROVIDER_STATUS_UNKNOWN', version=version+1, updated_at=${Date.now()} WHERE payment_intent_id='${paymentIntentId}';`,
    );
    await page.reload();
    const refundCard = page.getByText("ESCALATED", { exact: true }).locator("..").locator("..");
    await expect(refundCard).toBeVisible();

    const checks: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/payments/refunds/recheck", async (route) => {
      checks.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (checks.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await refundCard.getByRole("button", { name: "Check provider status", exact: true }).click();
    await refundCard.getByLabel("Provider check reason").fill("Verify provider progress");
    await refundCard.getByRole("button", { name: "Confirm provider check", exact: true }).click();
    await expect(refundCard.getByText(/The response is unknown/)).toBeVisible();
    await expect(refundCard.getByLabel("Provider check reason")).toBeDisabled();
    let failRefresh = width === 1440;
    if (failRefresh)
      await page.route(`**/api/admin/payments/${paymentIntentId}`, async (route) => {
        if (failRefresh) {
          failRefresh = false;
          await route.abort("failed");
        } else await route.continue();
      });
    await refundCard.getByRole("button", { name: "Retry saved provider check" }).click();
    await expect(
      refundCard.getByText(
        width === 1440
          ? /Provider check queued\. Current progress could not be refreshed/
          : /Provider check queued/,
      ),
    ).toBeVisible();
    expect(checks).toHaveLength(2);
    expect(checks[1]).toEqual(checks[0]);
    await page.reload();
    await expect(page.getByRole("heading", { name: paymentIntentId, exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("ESCALATED", { exact: true })).toHaveCount(1);
    await expect(page.getByText("PAYMENT.REFUND_REQUESTED", { exact: false })).toHaveCount(1);
    await expect(page.getByText("PAYMENT.REFUND_RECHECK_REQUESTED", { exact: false })).toHaveCount(
      1,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("refund.png"), fullPage: true });
  });
