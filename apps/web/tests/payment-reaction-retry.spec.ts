import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";
// Exhausted verified receipt is a fixture seam; queue/replay/reads use real Web/Core/D1.
for (const width of [1440, 390])
  test(`Retry an exhausted commitment at ${width}px`, async ({ adminPage: page }, testInfo) => {
    test.setTimeout(60000);
    const id = crypto.randomUUID(),
      now = Date.now(),
      receivedAt = now - 25 * 60 * 60 * 1000;
    const paymentId = `reaction-payment-${id}`,
      caseId = `reaction-case-${id}`;
    executeAdminE2eSql(`
 INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u-${id}','Event Customer','event-${id}@example.com',1,${now},${now});
 INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('cp-${id}','u-${id}','active',${now},${now});
 INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('c-${id}','u-${id}','cp-${id}','active',1,${now},${now});
 INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${paymentId}','GROCERY_CHECKOUT','checkout_quote','quote-${id}','c-${id}',1000,'PHP','SUCCEEDED','pi-${id}',2,${now},${now});
 INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('pa-${id}','c-${id}','${paymentId}','mock-${id}',1000,'PHP','SUCCEEDED','mock','pa-key-${id}',${now},${now});
 INSERT INTO payment_reaction(id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,attempts,available_at,created_at,updated_at) VALUES ('reaction-${id}','${paymentId}','COMMIT_ORDER','checkout_quote','quote-${id}','ESCALATED','reaction-key-${id}',5,${receivedAt},${receivedAt},${now});
 INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES ('${caseId}','${paymentId}','REACTION_FAILURE','OPEN','${JSON.stringify({ reactionId: `reaction-${id}`, errorCode: "MAX_ATTEMPTS_EXCEEDED" })}',${now});
 `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/payments/reconciliation");
    const target = page
      .getByRole("listitem")
      .filter({ has: page.locator(`a[href="/admin/payments/transactions/${paymentId}"]`) });
    await expect(
      target.getByRole("button", { name: "Retry paid commitment", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(target.getByRole("button", { name: "Review resolution" })).toBeDisabled();
    const writes: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/payments/reaction-retry", async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (writes.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await target
      .getByLabel("Commitment retry reason")
      .fill("Reviewed local event processing readiness");
    await target.getByRole("button", { name: "Retry paid commitment", exact: true }).click();
    await expect(target.getByText(/The response is unknown/)).toBeVisible();
    await target.getByRole("button", { name: "Retry saved commitment request" }).click();
    await expect(
      target.getByText("Commitment retry queued. Refresh for current progress.", { exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(JSON.parse(writes[0].body ?? "{}")).toMatchObject({ caseId, expectedVersion: 1 });
    await page.reload();
    await expect(target.getByText(/Paid commitment: PENDING/)).toBeVisible();
    await expect(
      target.getByRole("button", { name: "Retry paid commitment", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("payment-reaction-retry.png"),
      fullPage: true,
    });
  });
