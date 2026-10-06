import { expect, executeAdminE2eSql, test } from "./admin-authenticated-fixture";

// A fully refunded, never-committed payment is a fixture seam; closure itself is covered in Worker/D1.
for (const width of [1440, 390])
  test(`Do not create a manual task for completed refunded work at ${width}px`, async ({
    adminPage: page,
  }) => {
    test.setTimeout(60_000);
    const id = crypto.randomUUID();
    const now = Date.now();
    const paymentId = `refunded-payment-${id}`;
    executeAdminE2eSql(`
 INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u-${id}','Refunded Customer','refunded-${id}@example.com',1,${now},${now});
 INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('cp-${id}','u-${id}','active',${now},${now});
 INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('c-${id}','u-${id}','cp-${id}','active',1,${now},${now});
 INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${paymentId}','GROCERY_CHECKOUT','checkout_quote','quote-${id}','c-${id}',12500,'PHP','REFUNDED','pi-${id}',2,${now},${now});
 INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('pa-${id}','c-${id}','${paymentId}','mock-${id}',12500,'PHP','SUCCEEDED','mock','pa-key-${id}',${now},${now});
 INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,provider_refund_reference,created_at,updated_at) VALUES ('refund-${id}','${paymentId}',12500,'PHP','SUCCEEDED','Unable to commit groceries','refund-key-${id}','mock-refund-${id}',${now},${now});
 INSERT INTO payment_reaction(id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,attempts,available_at,created_at,updated_at) VALUES ('reaction-${id}','${paymentId}','COMMIT_ORDER','checkout_quote','quote-${id}','ESCALATED','reaction-key-${id}',5,0,${now},${now});
 INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES ('refunded-case-${id}','${paymentId}','REACTION_FAILURE','OPEN','${JSON.stringify({ reactionId: `reaction-${id}`, errorCode: "MAX_ATTEMPTS_EXCEEDED" })}',${now});
 `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/payments/reconciliation");
    await expect(page).toHaveURL(/\/admin\/payments\?tab=attention/u);
    await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Refunded Customer", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Payments", exact: true }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(`refunded-${id}@example.com`, "u") }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /resolution/iu })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
