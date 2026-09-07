import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

// Paid Order evidence is fixture setup. Admission and lost-response replay use real Web/Core/D1.
for (const width of [1440, 390])
  test(`Recover an accepted cancellation at ${width}px`, async ({ adminPage: page }, testInfo) => {
    const id = crypto.randomUUID(),
      now = Date.now();
    executeAdminE2eSql(`
    INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('${id}','Cancellation Customer','${id}@example.com',1,${now},${now});
    INSERT INTO customer_principal(id,auth_user_id,status,created_at,updated_at) VALUES ('${id}','${id}','active',${now},${now});
    INSERT INTO customer(id,auth_user_id,principal_id,status,created_at,updated_at) VALUES ('${id}','${id}','${id}','active',${now},${now});
    INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at)
      VALUES ('${id}','GROCERY_CHECKOUT','checkout_quote','${id}','${id}',500,'PHP','SUCCEEDED','${id}',1,${now},${now});
    INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES ('${id}','${id}','${id}',500,'PHP','SUCCEEDED','unconfigured-test-evidence','${id}',${now},${now});
    INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at)
      VALUES ('${id}','${id}','cycle-next-cebu','SCHEDULED','{}','COMMITTED',500,'PHP','${id}',1,${now});
    INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES ('${id}','${id}','${id}','${id}',${now});
    INSERT INTO order_fulfillment_snapshot(order_id,location_id,cycle_id,zone_id,cutoff_at,delivery_date,fulfillment_mode,sourcing_modes_json,created_at)
      VALUES ('${id}','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',${now + 86400000},${now + 172800000},'SCHEDULED','[]',${now});
  `);
    await page.setViewportSize({ width, height: 1000 });
    const writes: Array<{ body: string | null; key: string | undefined }> = [];
    const responses: unknown[] = [];
    await page.route(`**/api/admin/orders/${id}/cancel`, async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      responses.push(await response.json());
      if (writes.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page.goto(`/admin/orders/${id}`);
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    await page.getByLabel("Confirmation reason").fill("Unable to fulfill; refund customer");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved cancellation" })).toBeVisible();
    await page.getByRole("button", { name: "Retry saved cancellation" }).click();
    await expect(
      page.getByText("Cancellation accepted. Current refund progress is shown below.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    // Request correlation IDs differ; the frozen accepted operation is identical.
    expect(responses[0]).toMatchObject({
      ok: true,
      value: {
        state: "CANCELLATION_REQUESTED",
        cancellation: { status: "REQUESTED", requiredRefundMinor: 500 },
      },
    });
    const first = responseValue(responses[0]),
      second = responseValue(responses[1]);
    expect(second).toEqual(first);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /^Order / })).toBeVisible();
    await expect(page.getByText("Cancellation Requested", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel order", exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("cancellation.png") });
  });
function responseValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("value" in value))
    throw new Error("Missing operation receipt");
  return value.value;
}
