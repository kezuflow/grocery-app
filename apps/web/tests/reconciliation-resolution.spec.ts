import { expect, executeAdminE2eSql, test } from "./admin-authenticated-fixture";

// Completed linked evidence and an unmatched event are fixture seams; the visible read is real Web/Core/D1.
for (const width of [1440, 390])
  test(`Show only genuine unresolved payment issues at ${width}px`, async ({ adminPage: page }) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const paymentId = `review-payment-${id}`;
    executeAdminE2eSql(`
 INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u-${id}','Review Customer','review-${id}@example.com',1,${now},${now});
 INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('cp-${id}','u-${id}','active',${now},${now});
 INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) VALUES ('c-${id}','u-${id}','cp-${id}','active',1,${now},${now});
 INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${paymentId}','GROCERY_CHECKOUT','checkout_quote','quote-${id}','c-${id}',12500,'PHP','FAILED','pi-${id}',2,${now},${now});
 INSERT INTO payment_attempt(id,customer_id,payment_intent_id,provider_reference,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('pa-${id}','c-${id}','${paymentId}','mock-${id}',12500,'PHP','FAILED','mock','pa-key-${id}',${now},${now});
 INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES ('review-case-${id}','${paymentId}','AMBIGUOUS_OUTCOME','OPEN','{}',${now});
 INSERT INTO payment_reconciliation_case(id,category,status,details_json,created_at) VALUES ('unlinked-${id}','UNMAPPED_PROVIDER_REFERENCE','OPEN','${JSON.stringify({ provider: "mock", providerEventId: `event-${id}` })}',${now + 1});
 `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/payments/reconciliation");
    await expect(page).toHaveURL(/\/admin\/payments\?tab=attention/u);
    await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Needs attention/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Review Customer", { exact: true })).toHaveCount(0);
    const unmatched = page.getByRole("row", { name: /Unmatched payment/u }).last();
    await unmatched.click();
    await expect(page.getByRole("heading", { name: "Unmatched payment" })).toBeVisible();
    await expect(page.getByText(/No safe staff action/u)).toBeVisible();
    await expect(page.getByRole("button", { name: /resolution/iu })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
