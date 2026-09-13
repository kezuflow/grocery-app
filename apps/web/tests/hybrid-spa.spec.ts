import { expect, test } from "./admin-authenticated-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("freshmarkets.location-prompt-dismissed", "1"),
  );
});

test("catalog navigation, search and history retain the document and shell", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose delivery address", exact: true }),
  ).toBeEnabled();
  const shell = page.locator(".fm-storefront").first();
  const header = await shell.locator("header").first().elementHandle();
  const origin = await page.evaluate(() => performance.timeOrigin);
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/catalog")) reads.push(request.url());
  });
  const fruits = page
    .getByRole("navigation", { name: "Grocery categories" })
    .getByRole("link", { name: "Fruits", exact: true });
  await fruits.click();
  await expect(page).toHaveURL(/category=fruits/);
  await expect(page.locator("#catalog article").first()).toBeVisible();
  expect(
    reads.filter((url) => new URL(url).searchParams.get("category") === "fruits"),
  ).toHaveLength(1);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  expect(
    await header?.evaluate(
      (element) => element === document.querySelector(".fm-storefront header"),
    ),
  ).toBe(true);
  const search = page.locator("#storefront-search");
  await search.fill("no-matching-grocery-hspa");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No groceries found" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/category=fruits/);
  await expect(page.locator("#catalog article").first()).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "No groceries found" })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  reads.length = 0;
  await page.reload();
  await expect(page.getByRole("heading", { name: "No groceries found" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(reads).toHaveLength(0);
});

test("category keyboard activation and horizontal drag remain distinct", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose delivery address", exact: true }),
  ).toBeEnabled();
  const nav = page.getByRole("navigation", { name: "Grocery categories" });
  const fruits = nav.getByRole("link", { name: "Fruits", exact: true });
  await fruits.focus();
  await fruits.press("Enter");
  await expect(page).toHaveURL(/category=fruits/);
  await expect(page.locator("#catalog article").first()).toBeVisible();
  const before = page.url();
  const box = await nav.boundingBox();
  if (!box) throw new Error("Category strip missing");
  await page.mouse.move(box.x + 250, box.y + 45);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 45, { steps: 12 });
  await page.mouse.up();
  expect(page.url()).toBe(before);
  expect(await nav.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test.describe("touch catalog navigation", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("a touch tap activates a category without replacing the document", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Choose delivery address", exact: true }),
    ).toBeEnabled();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const fruits = page
      .getByRole("navigation", { name: "Grocery categories" })
      .getByRole("link", { name: "Fruits", exact: true });
    await fruits.tap();
    await expect(page).toHaveURL(/category=fruits/);
    await expect(page.locator("#catalog article").first()).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  });
});

test("storefront product, cart and account interactions preserve shell identity", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose delivery address", exact: true }),
  ).toBeEnabled();
  const origin = await page.evaluate(() => performance.timeOrigin);
  const header = await page.locator(".fm-storefront header").first().elementHandle();
  await page.locator("#catalog article").first().getByRole("link").first().click();
  await page.getByRole("dialog").getByRole("link", { name: "View full details" }).click();
  await expect(page).toHaveURL(/\/products\//);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  expect(
    await header?.evaluate(
      (element) => element === document.querySelector(".fm-storefront header"),
    ),
  ).toBe(true);

  await page.getByRole("link", { name: /^Cart/ }).click();
  await expect(page.getByRole("dialog", { name: "Shopping cart" })).toBeVisible();
  await page.getByRole("button", { name: "Close cart" }).click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.locator("#catalog article").first()).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);

  const productHref = await page
    .locator("#catalog article")
    .first()
    .getByRole("link")
    .first()
    .getAttribute("href");
  if (!productHref) throw new Error("Product detail link missing");
  const deepEntry = await page.goto(productHref);
  expect(deepEntry?.status()).toBe(200);
  await expect(page.locator(".fm-storefront")).toBeVisible();
  const refreshed = await page.reload();
  expect(refreshed?.status()).toBe(200);
  await expect(page.locator(".fm-storefront")).toBeVisible();
  expect((await page.request.get("/not-a-real-hspa-route")).status()).toBe(404);
});

test("authenticated Admin product list and detail retain shell; denied principal stays denied", async ({
  adminPage,
  deniedAdminPage,
}) => {
  await adminPage.goto("/admin/catalog/products");
  await expect(adminPage.getByRole("table", { name: "Products" })).toBeVisible();
  const origin = await adminPage.evaluate(() => performance.timeOrigin);
  await adminPage.locator('tbody button[aria-controls="product-detail-panel"]').first().click();
  await expect(
    adminPage.locator("#product-detail-panel").getByRole("link", { name: "Edit", exact: true }),
  ).toBeVisible();
  expect(await adminPage.evaluate(() => performance.timeOrigin)).toBe(origin);
  const adminHeader = await adminPage.locator("header[data-admin-environment]").elementHandle();
  await adminPage
    .locator("#product-detail-panel")
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  await expect(adminPage).toHaveURL(/\/admin\/catalog\/products\/[^/]+\/edit/);
  await expect(adminPage.getByRole("heading", { name: "Edit product" })).toBeVisible();
  expect(await adminPage.evaluate(() => performance.timeOrigin)).toBe(origin);
  expect(
    await adminHeader?.evaluate(
      (element) => element === document.querySelector("header[data-admin-environment]"),
    ),
  ).toBe(true);
  await adminPage.goBack();
  await expect(adminPage.getByRole("table", { name: "Products" })).toBeVisible();
  expect(await adminPage.evaluate(() => performance.timeOrigin)).toBe(origin);
  await deniedAdminPage.goto("/admin/catalog/products");
  await expect(deniedAdminPage.getByRole("table", { name: "Products" })).toHaveCount(0);
});
