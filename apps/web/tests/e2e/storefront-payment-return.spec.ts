import { expect, test } from "@playwright/test";

test("a payment return waits for the Order receipt and then exposes the confirmed Order", async ({
  page,
}) => {
  let statusReads = 0;
  let orderReads = 0;
  await page.route("**/api/checkout/payment/status?**", (route) => {
    statusReads += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          paymentIntentId: "payment-return-test",
          state: statusReads === 1 ? "FINALIZING_ORDER" : "COMPLETED",
          orderId: statusReads === 1 ? null : "order-return-test",
        },
      }),
    });
  });
  await page.route("**/api/commerce/orders?**", (route) => {
    orderReads += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          items:
            orderReads === 1
              ? []
              : [
                  {
                    id: "order-return-test",
                    orderNumber: "FM-RETURN-TEST",
                    status: "COMMITTED",
                    fulfillmentMode: "SCHEDULED",
                    deliveryDate: null,
                    promisedAt: null,
                    committedAt: "2026-09-28T04:00:00.000Z",
                    totalMinor: 7100,
                    currency: "PHP",
                    itemCount: 1,
                  },
                ],
          nextCursor: null,
        },
      }),
    });
  });
  await page.goto("/orders?payment=return&paymentIntentId=payment-return-test");
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View confirmed order" })).toHaveAttribute(
    "href",
    "/orders/order-return-test",
  );
  await expect(page.getByRole("link", { name: "View order FM-RETURN-TEST" })).toBeVisible();
  expect(statusReads).toBeGreaterThanOrEqual(2);
  expect(orderReads).toBeGreaterThanOrEqual(2);
});
