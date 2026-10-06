import { expect, executeAdminE2eSql, test } from "./admin-authenticated-fixture";

for (const width of [1440, 390])
  test(`Use the simplified Payments workspace at ${width}px`, async ({ adminPage: page }) => {
    test.setTimeout(60_000);
    const id = crypto.randomUUID();
    const now = Date.now();
    const paidId = `paid-${id}`;
    const unpaidId = `unpaid-${id}`;
    const orderId = `order-${id}`;
    executeAdminE2eSql(`
 INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('paid-user-${id}','Paid Customer ${id}','paid-${id}@example.com',1,${now},${now});
 INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('paid-principal-${id}','paid-user-${id}','active',${now},${now});
 INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('paid-customer-${id}','paid-user-${id}','paid-principal-${id}','active',1,${now},${now});
 INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${paidId}','GROCERY_CHECKOUT','checkout_quote','quote-${id}','paid-customer-${id}',4200,'PHP','SUCCEEDED','paid-key-${id}',2,${now},${now});
 INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('paid-attempt-${id}','paid-customer-${id}','${paidId}','mock-paid-${id}',4200,'PHP','SUCCEEDED','mock','paid-attempt-key-${id}',${now},${now});
 INSERT INTO grocery_order(id,customer_id,payment_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,version,created_at,committed_at,order_number) VALUES ('${orderId}','paid-customer-${id}','paid-attempt-${id}','INSTANT','{}','COMMITTED',4200,'PHP',1,${now},${now},'FM-${id.slice(0, 8)}');
 INSERT INTO payment_reaction(id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,attempts,available_at,created_at,updated_at) VALUES ('reaction-${id}','${paidId}','COMMIT_ORDER','checkout_quote','quote-${id}','ESCALATED','reaction-key-${id}',5,${now},${now},${now});
 INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES ('case-a-${id}','${paidId}','REACTION_FAILURE','OPEN','${JSON.stringify({ reactionId: `reaction-${id}`, errorCode: "MAX_ATTEMPTS_EXCEEDED" })}',${now});
 INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES ('case-b-${id}','${paidId}','REACTION_FAILURE','OPEN','${JSON.stringify({ reactionId: `reaction-${id}`, errorCode: "MAX_ATTEMPTS_EXCEEDED" })}',${now + 1});
 INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('unpaid-user-${id}','Unpaid Customer ${id}','unpaid-${id}@example.com',1,${now},${now});
 INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('unpaid-principal-${id}','unpaid-user-${id}','active',${now},${now});
 INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('unpaid-customer-${id}','unpaid-user-${id}','unpaid-principal-${id}','active',1,${now},${now});
 INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${unpaidId}','GROCERY_CHECKOUT','checkout_quote','unpaid-quote-${id}','unpaid-customer-${id}',5100,'PHP','REQUIRES_ACTION','unpaid-key-${id}',1,${now + 2},${now + 2});
 INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('unpaid-attempt-${id}','unpaid-customer-${id}','${unpaidId}','mock-unpaid-${id}',5100,'PHP','REQUIRES_ACTION','mock','unpaid-attempt-key-${id}',${now + 2},${now + 2});
 `);

    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/payments");
    await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "All attempts" })).toHaveCount(0);
    const paidRow = page.getByRole("row", { name: new RegExp(`Paid Customer ${id}`, "u") });
    await expect(paidRow).toBeVisible();
    await expect(page.getByText(`Unpaid Customer ${id}`, { exact: true })).toHaveCount(0);
    await expect(paidRow.getByRole("link", { name: `FM-${id.slice(0, 8)}` })).toHaveAttribute(
      "href",
      `/admin/orders/${orderId}`,
    );
    await paidRow.focus();
    await paidRow.press("Enter");
    await expect(page.getByRole("heading", { name: `FM-${id.slice(0, 8)}` })).toBeVisible();
    await expect(page.locator("details", { hasText: "Technical details" })).not.toHaveAttribute(
      "open",
      "",
    );
    await page.getByRole("button", { name: "Close payment details" }).click();

    await page.getByRole("tab", { name: /Needs attention/u }).click();
    const issueRows = page.getByRole("row", { name: new RegExp(`Paid Customer ${id}`, "u") });
    await expect(issueRows).toHaveCount(1);
    await issueRows.click();
    await expect(page.getByRole("button", { name: "Retry Order confirmation" })).toBeVisible();
    await expect(page.getByLabel("Recovery reason")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry Order confirmation" }).click();
    await expect(page.getByLabel("Recovery reason")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("tab", { name: /Needs attention/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.goto(`/admin/payments/transactions/${unpaidId}`);
    await expect(page).toHaveURL(new RegExp(`/admin/payments\\?payment=${unpaidId}`, "u"));
    await expect(page.getByText("Awaiting payment", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refund", exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
