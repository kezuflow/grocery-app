import { expect, test } from "@playwright/test";

/**
 * Storefront marketplace flows against a provisioned local stack. Skips when
 * the stack is unreachable so repository verification stays environment-safe.
 * Anonymous interactions assert the authentication boundary: browsing is
 * public, cart mutation requires a signed-in customer.
 */
let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get("/");
    stackUp = response.status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
});

test("the marketplace home server-renders categories, rails, and membership context", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shop fresh, live well" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily deals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fresh this week" })).toHaveCount(0);
  await expect(page.getByText("Membership eligibility is checked at checkout.")).toBeVisible();
  // Seeded catalog content renders with prices and fixed-variant labels.
  const strawberries = page.getByRole("heading", { name: "Baguio Strawberries" }).first();
  await expect(strawberries).toBeVisible();
  await expect(page.getByText("₱179.00").first()).toBeVisible();
  await expect(page.getByText("500 g").first()).toBeVisible();
});

test("the membership offer returns after a full page refresh", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const offer = page.getByRole("complementary", { name: "FreshMarkets membership offer" });

  await expect(offer).toBeVisible();
  await page.getByRole("button", { name: "Dismiss membership offer" }).click();
  await expect(offer).toBeHidden();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(offer).toBeVisible();
});

test("daily deals advances with gallery controls", async ({ page }) => {
  await page.goto("/");
  const gallery = page.getByTestId("daily-deals-gallery");
  const before = await gallery.evaluate((element) => element.scrollLeft);

  await page.getByRole("button", { name: "Next deal" }).click();
  await expect
    .poll(() => gallery.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(before);
});

test("category navigation filters the catalog server-side", async ({ page }) => {
  await page.goto("/?category=fruits");
  await expect(page.getByRole("heading", { name: "Fruits", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Creamy Avocado" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Native Garlic" })).toHaveCount(0);
});

test("search narrows results with an explicit count and empty state", async ({ page }) => {
  await page.goto("/?q=strawberry");
  await expect(page.getByRole("heading", { name: "Results for “strawberry”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Baguio Strawberries" }).first()).toBeVisible();

  await page.goto("/?q=zzznothing");
  await expect(page.getByRole("heading", { name: "No groceries found" })).toBeVisible();
});

test("a product card opens the quick-view dialog with fixed variants", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Baguio Strawberries details" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Baguio Strawberries" })).toBeVisible();
  await expect(dialog.getByText("Choose a fixed pack")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /500 g/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /1 kg/ })).not.toBeChecked();
});

test("anonymous add-to-cart saves the item and offers sign-in without redirecting", async ({
  page,
}) => {
  await page.goto("/");
  const addButton = page.getByRole("button", { name: "Add Baguio Strawberries to cart" }).first();
  await addButton.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Baguio Strawberries added to your cart" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  // Browsing context is preserved.
  await expect(page).toHaveURL("/");
});

test("guest cart remains visible and asks for sign-in before checkout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Baguio Strawberries to cart" }).first().click();
  await page.getByRole("link", { name: "Cart, 1 item" }).click();
  const drawer = page.getByRole("dialog", { name: "Shopping cart" });
  await expect(drawer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(drawer.getByText("Baguio Strawberries", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Sign in to checkout")).toBeVisible();
  await expect(drawer.getByText(/minimum order.*confirmed at checkout/i)).toBeVisible();
});

test("guest cart survives client navigation after an anonymous add", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Baguio Strawberries to cart" }).first().click();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Cart items" }).getByText("Baguio Strawberries"),
  ).toBeVisible();
});

test("an empty signed-out cart does not show a load error", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByText("Unable to load your cart right now.")).toHaveCount(0);
});

test("home uses a DoorDash-style discovery hierarchy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("storefront-category-strip")).toBeVisible();
  await expect(page.getByTestId("storefront-promo-banner")).toBeVisible();
  await expect(page.getByTestId("storefront-membership-strip")).toBeVisible();
  await expect(
    page.getByTestId("storefront-category-strip").getByText("All groceries"),
  ).toBeVisible();
});

test("empty cart uses the shared storefront summary and recovery state", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Order summary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue shopping" }).last()).toBeVisible();
});

test("checkout uses progressive delivery sections and a shared order summary", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Delivery details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivery cycle" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Order summary" })).toBeVisible();
});

test("category results paginate through Core cursors without duplicates", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/?category=vegetables");
  await expect(page.getByRole("heading", { name: "Vegetables", level: 2 })).toBeVisible();
  const cards = page.getByRole("article");
  const initialCount = await cards.count();
  expect(initialCount).toBeGreaterThan(0);

  const button = page.getByTestId("load-more");
  await expect(button).toBeVisible();
  await button.click();

  // The follow-up cursor page appends unique products until exhausted.
  await expect(button).toBeHidden();
  const finalCount = await cards.count();
  expect(finalCount).toBeGreaterThan(initialCount);

  const productLinks = await cards.evaluateAll((articles) =>
    articles.map(
      (article) => article.querySelector<HTMLAnchorElement>('a[href^="/products/"]')?.href,
    ),
  );
  expect(new Set(productLinks).size).toBe(productLinks.length);
  expect(consoleErrors).toEqual([]);
});

test("an assembled chili pack leads with its contents note and no ops instructions", async ({
  page,
}) => {
  await page.goto("/products/chili-pepper-fruit-siling-labuyo");
  const packRadio = page.getByRole("radio", { name: /1 pack/ });
  await expect(packRadio).toBeAttached();
  await expect(packRadio).toBeChecked();
  await expect(page.getByText(/Approximately 10–15 chili peppers per pack/).first()).toBeVisible();
  await expect(page.getByText("Pack 100 g per bag.")).toHaveCount(0);
  const image = page.getByRole("img", { name: /Siling Labuyo/ }).first();
  await expect
    .poll(async () => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test("weight-sold staples keep their fixed gram variants", async ({ page }) => {
  await page.goto("/products/potato");
  for (const label of [/250\s?g/, /500\s?g/, /1\s?kg/]) {
    await expect(page.getByRole("radio", { name: label })).toBeAttached();
  }
  await expect(page.getByRole("radio", { name: /250\s?g/ })).toBeChecked();
});

test("products whose core media is unavailable render the leaf placeholder", async ({ page }) => {
  await page.route("**/api/catalog/product?slug=potato*", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      value?: { product?: { media?: unknown } };
    };
    if (payload.value?.product) payload.value.product.media = null;
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/products/potato");
  await expect(page.getByRole("img", { name: "Potatoes product image" })).toBeVisible();
});
