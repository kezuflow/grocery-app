import { expect, test } from "@playwright/test";

test("pages order history and applies filters before showing an empty state", async ({ page }) => {
  const requests: string[] = [];
  const item = (id: string, status = "COMMITTED") => ({
    id,
    orderNumber: id,
    status,
    fulfillmentMode: "INSTANT",
    deliveryDate: null,
    promisedAt: null,
    committedAt: "2026-09-07T00:00:00.000Z",
    totalMinor: 15000,
    currency: "PHP",
    itemCount: 2,
  });
  // This browser acceptance covers rendering/navigation with controlled RPC DTOs.
  // Worker/D1 integration tests independently exercise the authoritative query.
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/commerce/orders") {
      await route.fulfill({
        json: url.pathname.startsWith("/api/auth/")
          ? null
          : { ok: false, error: { code: "UNAUTHENTICATED" } },
      });
      return;
    }
    requests.push(url.search);
    const completed = url.searchParams.get("filter") === "completed";
    const second = url.searchParams.has("cursor");
    await route.fulfill({
      json: {
        ok: true,
        value: {
          items: completed
            ? [item("FM-COMPLETED", "DELIVERED")]
            : [item(second ? "FM-OLDER" : "FM-RECENT")],
          nextCursor: completed || second ? null : "next-history-page",
        },
      },
    });
  });
  await page.goto("/orders");
  await expect(page.getByRole("link", { name: "View order FM-RECENT" })).toBeVisible();
  await page.getByRole("button", { name: "Load more orders" }).click();
  await expect(page.getByRole("link", { name: "View order FM-OLDER" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View order FM-RECENT" })).toBeVisible();
  expect(requests[1]).toContain("cursor=next-history-page");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Completed" }).click();
  await expect(page.getByRole("link", { name: "View order FM-COMPLETED" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View order FM-RECENT" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load more orders" })).toHaveCount(0);
  expect(requests.at(-1)).toBe("?filter=completed");
});
