import { test, expect, executeAdminE2eSql, queryAdminE2eSql } from "./admin-authenticated-fixture";

// Captured Order linkage and definitive rejection are fixture evidence; retry uses real Web/Core/D1 and the test provider.
for (const width of [1440, 390])
  test(`Retry a rejected cancellation refund at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const suffix = crypto.randomUUID(),
      now = Date.now();
    const paymentId = `retry-payment-${suffix}`,
      orderId = `retry-order-${suffix}`,
      rejectedId = `retry-rejected-${suffix}`;
    executeAdminE2eSql(`
      INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('retry-user-${suffix}','Refund Customer','retry-${suffix}@example.com',1,${now},${now});
      INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('retry-principal-${suffix}','retry-user-${suffix}','active',${now},${now});
      INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('retry-customer-${suffix}','retry-user-${suffix}','retry-principal-${suffix}','active',1,${now},${now});
      INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at)
        VALUES ('${paymentId}','GROCERY_CHECKOUT','order','${orderId}','retry-customer-${suffix}',12500,'PHP','SUCCEEDED','retry-intent-${suffix}',1,${now},${now});
      INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
        VALUES ('retry-attempt-${suffix}','retry-customer-${suffix}','${paymentId}','mock-captured-${suffix}',12500,'PHP','SUCCEEDED','mock','retry-attempt-key-${suffix}',${now},${now});
      INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at,order_number,committed_at)
        VALUES ('${orderId}','retry-customer-${suffix}',NULL,'INSTANT','{}','CANCELLATION_REQUESTED',12500,'PHP','retry-attempt-${suffix}',2,${now},'FM-RETRY-${suffix}',${now});
      INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at)
        VALUES ('retry-reaction-${suffix}','${paymentId}','retry-reaction-key-${suffix}','${orderId}',${now});
      INSERT INTO order_cancellation(id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,required_refund_minor,currency,version,created_at,updated_at)
        VALUES ('retry-cancellation-${suffix}','${orderId}','CUSTOMER','CUSTOMER_REQUEST','Customer request','EXCEPTION',0,12500,'PHP',1,${now},${now});
      INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at)
        VALUES ('${rejectedId}','${paymentId}',12500,'PHP','REJECTED','Customer request','order-cancel:retry-cancellation-${suffix}:${paymentId}',2,${now},${now});
      INSERT INTO order_cancellation_refund_member(id,cancellation_id,payment_intent_id,required_amount_minor,currency,refund_id,status,attempts,created_at,updated_at)
        VALUES ('retry-member-${suffix}','retry-cancellation-${suffix}','${paymentId}',12500,'PHP','${rejectedId}','REJECTED',1,${now},${now});
    `);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`/admin/payments/transactions/${paymentId}`);
    const retry = page.getByRole("button", { name: "Retry refund", exact: true });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    await retry.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Retry refund", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Keep unchanged", exact: true }).click();
    await expect(retry).toBeFocused();
    await retry.click();
    await dialog.getByLabel("Confirmation reason").fill("Provider account funded");
    await expect(dialog).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath(`refund-retry-${width}.png`) });
    const writes: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/payments/refunds/retry", async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (writes.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({
        ok: true,
        value: { amountMinor: 12500, status: "REQUESTED" },
      });
      await route.abort("failed");
    });
    await dialog.getByRole("button", { name: "Retry refund", exact: true }).click();
    await expect(
      page.getByText("The response is unknown. Retry the saved request to recover its result."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry saved refund retry", exact: true }).click();
    await expect(
      page.getByText("Refund retry accepted. Current provider progress is shown below.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(JSON.parse(writes[0].body ?? "{}")).toMatchObject({
      refundId: rejectedId,
      expectedVersion: 2,
      reason: "Provider account funded",
    });
    await expect(
      page.getByRole("button", { name: "Close payment details", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await expect(page.getByText("PROCESSING", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Retry refund", exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    const detail = await page.request.get(`/api/admin/orders/${orderId}`);
    expect(await detail.json()).toMatchObject({
      ok: true,
      value: {
        status: "CANCELLATION_REQUESTED",
      },
    });
    expect(
      queryAdminE2eSql(`SELECT cancellation.status AS cancellationStatus,member.status AS memberStatus,refund.status AS refundStatus
      FROM order_cancellation cancellation JOIN order_cancellation_refund_member member ON member.cancellation_id=cancellation.id
      JOIN payment_refund refund ON refund.id=member.refund_id WHERE cancellation.order_id='${orderId}'`),
    ).toMatchObject([
      {
        results: [
          {
            cancellationStatus: "REFUNDS_PROCESSING",
            memberStatus: "PROCESSING",
            refundStatus: "PROCESSING",
          },
        ],
      },
    ]);
    const profile = await (await page.request.get("/api/commerce/profile")).json();
    expect(profile.ok).toBe(true);
    const owner = profile.value.customerId as string;
    expect(owner).toMatch(/^[a-zA-Z0-9-]+$/);
    // Only this disposable fixture is assigned to the signed-in customer for the private claim read.
    executeAdminE2eSql(`UPDATE grocery_order SET customer_id='${owner}' WHERE id='${orderId}';
      UPDATE payment_intent SET customer_id='${owner}' WHERE id='${paymentId}';
      UPDATE payment_attempt SET customer_id='${owner}' WHERE payment_intent_id='${paymentId}';
      UPDATE payment_refund SET claim_url='https://transfer.paymongo.com/fixture-claim-${suffix}',claim_expires_at=${Date.now() + 259200000}
        WHERE payment_intent_id='${paymentId}' AND status='PROCESSING';`);
    const customerDetail = await page.request.get(`/api/commerce/orders/${orderId}`);
    expect(customerDetail.headers()["cache-control"]).toBe("private, no-store");
    expect(await customerDetail.json()).toMatchObject({
      ok: true,
      value: { status: "CANCELLATION_REQUESTED" },
    });
    await page.goto(`/orders/${orderId}`);
    const claim = page.getByRole("link", { name: "Claim refund", exact: true });
    await expect(claim).toHaveAttribute(
      "href",
      `https://transfer.paymongo.com/fixture-claim-${suffix}`,
    );
    await expect(claim).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(
      page.getByText("Your refund remains processing until it is confirmed.", { exact: false }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`refund-claim-${width}.png`),
      fullPage: true,
    });
    executeAdminE2eSql(
      `UPDATE payment_refund SET claim_expires_at=1 WHERE payment_intent_id='${paymentId}' AND status='PROCESSING'`,
    );
    await page.reload();
    await expect(claim).toHaveCount(0);
  });
