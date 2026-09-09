import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { executeAdminE2eSql } from "./admin-authenticated-fixture";

/** Both paid journeys exercise the production signed inbox with the local fake provider. */
export async function completeLocalCourierDelivery(
  admin: Page,
  page: Page,
  orderId: string,
  locationId: string,
) {
  async function read(browser: Page, path: string): Promise<unknown> {
    const response = await browser.request.get(path);
    expect(response.ok()).toBe(true);
    return z.object({ ok: z.literal(true), value: z.unknown() }).parse(await response.json()).value;
  }
  const deliverySchema = z.object({
    items: z.array(
      z.object({
        orderId: z.string(),
        status: z.string(),
        version: z.number(),
        externalDispatch: z
          .object({
            dispatchId: z.string(),
            status: z.string(),
            version: z.number(),
            providerDeliveryId: z.string().nullable(),
          })
          .nullable(),
      }),
    ),
  });
  async function delivery() {
    const item = deliverySchema
      .parse(await read(admin, `/api/admin/delivery?locationId=${locationId}&limit=100`))
      .items.find((item) => item.orderId === orderId);
    if (!item) throw new Error("Missing active delivery job");
    return item;
  }
  await page.goto(`/orders/${orderId}`);
  const attempt = (await delivery()).externalDispatch;
  const providerDeliveryId = attempt?.providerDeliveryId;
  if (!providerDeliveryId || !attempt) throw new Error("Missing booked provider delivery identity");
  const callbackPath = "/webhooks/delivery/lalamove";
  for (const [index, status] of (["ON_GOING", "PICKED_UP", "COMPLETED"] as const).entries()) {
    const timestamp = String(Date.now() + index);
    const data = {
      order: { orderId: providerDeliveryId, status },
      updatedAt: new Date(Number(timestamp)).toISOString(),
    };
    const callback = {
      apiKey: "pk_browser_synthetic",
      timestamp,
      eventId: crypto.randomUUID(),
      eventType: "ORDER_STATUS_CHANGED",
      eventVersion: "v3",
      data,
      signature: createHmac("sha256", "sk_browser_synthetic")
        .update(`${timestamp}\r\nPOST\r\n${callbackPath}\r\n\r\n${JSON.stringify(data)}`)
        .digest("hex"),
    };
    const before = await delivery();
    expect(
      (
        await admin.request.post(callbackPath, {
          data: { ...callback, signature: "0".repeat(64) },
        })
      ).status(),
    ).toBe(401);
    expect(await delivery()).toEqual(before);
    const applied = await admin.request.post(callbackPath, { data: callback });
    expect(applied.status()).toBe(200);
    if (status === "COMPLETED") {
      const after = await read(page, `/api/commerce/orders/${orderId}`);
      expect(after).toMatchObject({ status: "DELIVERED" });
      expect((await admin.request.post(callbackPath, { data: callback })).status()).toBe(200);
      expect(await read(page, `/api/commerce/orders/${orderId}`)).toEqual(after);
      expect(
        deliverySchema
          .parse(await read(admin, `/api/admin/delivery?locationId=${locationId}&limit=100`))
          .items.some((item) => item.orderId === orderId),
      ).toBe(false);
    } else {
      expect((await delivery()).status).toBe(status === "ON_GOING" ? "ASSIGNED" : "EN_ROUTE");
      const after = await delivery();
      expect((await admin.request.post(callbackPath, { data: callback })).status()).toBe(200);
      expect(await delivery()).toEqual(after);
    }
    if (status !== "ON_GOING") {
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: status === "PICKED_UP" ? "Out for delivery" : "Delivered",
          exact: true,
        }),
      ).toBeVisible();
    }
  }
  const dispatchIdSql = `'${attempt.dispatchId.replaceAll("'", "''")}'`;
  await admin.goto(`/admin/delivery?orderId=${encodeURIComponent(orderId)}`);
  const completedRow = admin.getByRole("row").filter({ hasText: orderId });
  await expect(completedRow).toHaveCount(1);
  await expect(completedRow).toContainText("DELIVERED");
  await admin.getByRole("link", { name: "Show all delivery work", exact: true }).click();
  await expect(admin).toHaveURL(/\/admin\/delivery$/);
  // Read-only on success: fail the disposable DB assertion if either transition lost its intent.
  executeAdminE2eSql(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
    (SELECT COUNT(*) FROM notification_outbox WHERE idempotency_key IN (
      'delivery:' || ${dispatchIdSql} || ':OUT_FOR_DELIVERY',
      'delivery:' || ${dispatchIdSql} || ':DELIVERED') AND status='PENDING') <> 2;`);
}
