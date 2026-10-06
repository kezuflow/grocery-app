import { expect, type Page } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { executeAdminE2eSql } from "./admin-authenticated-fixture";

/** Real local commands; lose the first response after custody commits and retry its saved identity. */
export async function completeLocalManualDelivery(admin: Page, customer: Page, orderId: string) {
  await admin.goto(`/admin/delivery?orderId=${encodeURIComponent(orderId)}`);
  const row = admin.getByRole("row").filter({ hasText: orderId });
  await row.getByRole("button", { name: "Assign manual rider", exact: true }).click();
  await row.getByLabel("Person delivering", { exact: true }).fill("Synthetic delivery helper");
  await row.getByLabel("Phone including country code", { exact: true }).fill("+639171110002");
  const attempts: { body: string | null; key: string | undefined }[] = [];
  await admin.route("**/api/admin/manual-deliveries", async (route) => {
    attempts.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    if (attempts.length > 1) return route.continue();
    expect(await (await route.fetch()).json()).toMatchObject({ ok: true });
    await route.abort("failed");
  });
  await row.getByRole("button", { name: "Review assign and hand over order", exact: true }).click();
  const confirmation = admin.getByRole("alertdialog", {
    name: "Confirm assign and hand over order",
  });
  await expect(confirmation).toContainText("Out for delivery");
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row.getByText("The result is unknown.", { exact: false })).toBeVisible();
  const detail = async () => {
    const response = await customer.request.get(`/api/commerce/orders/${orderId}`);
    expect(response.ok()).toBe(true);
    return z
      .object({ ok: z.literal(true), value: z.object({ status: z.string() }) })
      .parse(await response.json()).value;
  };
  expect((await detail()).status).toBe("OUT_FOR_DELIVERY");
  await row.getByRole("button", { name: "Retry saved request", exact: true }).click();
  await expect(row.getByRole("button", { name: "Record delivered", exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await admin.unroute("**/api/admin/manual-deliveries");
  await expect(
    row.getByRole("button", { name: "Hand over packed order", exact: true }),
  ).toHaveCount(0);
  await customer.goto(`/orders/${orderId}`);
  await expect(
    customer.getByRole("heading", { name: "Out for delivery", exact: true, level: 1 }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Record delivered", exact: true }).click();
  await row.getByRole("button", { name: "Review record delivered", exact: true }).click();
  await admin
    .getByRole("alertdialog", { name: "Confirm record delivered" })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  expect((await detail()).status).toBe("DELIVERED");
  await customer.reload();
  await expect(
    customer.getByRole("heading", { name: "Delivered", exact: true, level: 1 }),
  ).toBeVisible();
  const literal = `'${orderId.replaceAll("'", "''")}'`;
  executeAdminE2eSql(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
    (SELECT COUNT(*) FROM delivery_provider_dispatch d JOIN delivery_job j ON j.id=d.delivery_job_id WHERE j.order_id=${literal} AND d.method='MANUAL' AND d.status='COMPLETED' AND d.handed_over_at IS NOT NULL) <> 1 OR
    (SELECT COUNT(*) FROM audit_event a JOIN delivery_provider_dispatch d ON d.id=a.aggregate_id JOIN delivery_job j ON j.id=d.delivery_job_id WHERE j.order_id=${literal} AND a.action IN ('DELIVERY.MANUAL_ASSIGN','DELIVERY.MANUAL_COMPLETE')) <> 2 OR
    (SELECT COUNT(*) FROM notification_outbox WHERE aggregate_id=${literal} AND event_type IN ('OUT_FOR_DELIVERY','DELIVERED')) <> 2;`);
  expect(
    await customer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
}
