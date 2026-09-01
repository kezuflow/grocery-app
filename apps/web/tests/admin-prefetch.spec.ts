import type { Request } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";

function isRouterPrefetch(request: Request): boolean {
  const headers = request.headers();
  return headers.purpose === "prefetch" || headers["next-router-prefetch"] === "1";
}

test("idle dense Admin views do not prefetch expensive destinations", async ({ adminPage }) => {
  const prefetchedUrls: string[] = [];
  adminPage.on("request", (request) => {
    if (isRouterPrefetch(request)) prefetchedUrls.push(request.url());
  });

  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin/catalog/products");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await adminPage.waitForTimeout(750);

  expect(
    prefetchedUrls.filter(
      (url) =>
        url.endsWith("/") ||
        url.includes("/admin/catalog/products/new") ||
        /\/admin\/catalog\/products\/[^/?]+/.test(url),
    ),
  ).toEqual([]);
});

test("disabled automatic prefetch preserves intentional navigation", async ({ adminPage }) => {
  await adminPage.goto("/admin/catalog/products");
  const addProduct = adminPage
    .locator("#main-content")
    .getByRole("link", { name: "Add product" })
    .first();

  await expect(addProduct).toHaveAttribute("href", "/admin/catalog/products/new");
  await addProduct.click();
  await expect(adminPage).toHaveURL(/\/admin\/catalog\/products\/new$/);
  await expect(adminPage.getByRole("heading", { level: 1, name: "Add product" })).toBeVisible();
});
