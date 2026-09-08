import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";
// Final failed provider state is an explicit fixture; resolution/replay use actual Web/Core/D1.
for (const width of [1440, 390])
  test(`Review a financial exception at ${width}px`, async ({ adminPage: page }, testInfo) => {
    test.setTimeout(60000);
    const id = crypto.randomUUID(),
      now = Date.now();
    const paymentId = `review-payment-${id}`,
      caseId = `review-case-${id}`;
    executeAdminE2eSql(`
 INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u-${id}','Review Customer','review-${id}@example.com',1,${now},${now});
 INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('cp-${id}','u-${id}','active',${now},${now});
 INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('c-${id}','u-${id}','cp-${id}','active',1,${now},${now});
 INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${paymentId}','GROCERY_CHECKOUT','checkout_quote','quote-${id}','c-${id}',12500,'PHP','FAILED','pi-${id}',2,${now},${now});
 INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('pa-${id}','c-${id}','${paymentId}','mock-${id}',12500,'PHP','FAILED','mock','pa-key-${id}',${now},${now});
 INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES ('${caseId}','${paymentId}','AMBIGUOUS_OUTCOME','OPEN','{}',${now});
 INSERT INTO payment_reconciliation_case(id,category,status,details_json,created_at) VALUES ('unlinked-${id}','UNMAPPED_PROVIDER_REFERENCE','OPEN','{}',${now});
 `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/payments/reconciliation");
    await expect(
      page.getByRole("heading", { name: "Payment reconciliation", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const target = page
      .getByRole("listitem")
      .filter({ has: page.locator(`a[href="/admin/payments/transactions/${paymentId}"]`) });
    await expect(target.getByRole("button", { name: "Review resolution" })).toBeEnabled();
    const unlinked = page
      .getByRole("listitem")
      .filter({ hasText: "Payment evidence is not linked." });
    await expect(
      unlinked.first().getByRole("button", { name: "Review resolution" }),
    ).toBeDisabled();
    const writes: { body: string | null; key: string | undefined }[] = [];
    await page.route(`**/api/admin/payments/reconciliation/${caseId}/resolve`, async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (writes.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await target.getByRole("button", { name: "Review resolution" }).click();
    await page.getByLabel("Confirmation reason").fill("Confirmed failed provider payment");
    await page.getByRole("button", { name: "Confirm resolution", exact: true }).click();
    await expect(page.getByText(/The response is unknown/)).toBeVisible();
    await page.getByRole("button", { name: "Retry saved resolution" }).click();
    await expect(page.getByText("Reconciliation case resolved.", { exact: true })).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(JSON.parse(writes[0].body ?? "{}")).toMatchObject({
      expectedVersion: 1,
      reason: "Confirmed failed provider payment",
    });
    await expect(target).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Payment reconciliation", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Payment evidence is not linked.").first()).toBeVisible();
    await expect(target).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("reconciliation.png"), fullPage: true });
  });
