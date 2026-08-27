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

test("the marketplace home server-renders hero, categories, rails, and membership context", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shop fresh, live well" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fresh this week" }).first()).toBeVisible();
  await expect(page.getByText("FreshMarkets membership").first()).toBeVisible();
  // Seeded catalog content renders with prices and fixed-variant labels.
  const avocado = page.getByRole("heading", { name: "Creamy Avocado" }).first();
  await expect(avocado).toBeVisible();
  await expect(page.getByText("₱94.50").first()).toBeVisible();
  await expect(page.getByText("500 g · fixed pack").first()).toBeVisible();
});

test("category navigation filters the catalog server-side", async ({ page }) => {
  await page.goto("/?category=fruits");
  await expect(page.getByRole("heading", { name: "Fruits", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Creamy Avocado" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Native Garlic" })).toHaveCount(0);
});

test("search narrows results with an explicit count and empty state", async ({ page }) => {
  await page.goto("/?q=mango");
  await expect(page.getByRole("heading", { name: "Results for “mango”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Carabao Mangoes" }).first()).toBeVisible();

  await page.goto("/?q=zzznothing");
  await expect(page.getByRole("heading", { name: "No groceries found" })).toBeVisible();
});

test("a product card opens the quick-view dialog with fixed variants", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Creamy Avocado details" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Creamy Avocado" })).toBeVisible();
  await expect(dialog.getByText("Choose a fixed pack")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /500 g/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /1 kg/ })).not.toBeChecked();
});

test("anonymous add-to-cart saves the item and offers sign-in without redirecting", async ({
  page,
}) => {
  await page.goto("/");
  const addButton = page.getByRole("button", { name: "Add Creamy Avocado to cart" }).first();
  await addButton.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Creamy Avocado added to your cart" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  // Browsing context is preserved.
  await expect(page).toHaveURL("/");
});

test("guest cart remains visible and asks for sign-in before checkout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Creamy Avocado to cart" }).first().click();
  await page.getByRole("link", { name: "Cart, 1 item" }).click();
  await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();
  await expect(page.getByText("Creamy Avocado")).toBeVisible();
  await expect(page.getByText("Sign in to checkout")).toBeVisible();
  await expect(page.getByText(/minimum order is confirmed/i)).toBeVisible();
});

test("guest cart survives client navigation after an anonymous add", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Red onion to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  await page.getByRole("link", { name: "Cart, 1 item" }).click();
  await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();
  await expect(page.getByText("Red onion")).toBeVisible();
});

test("an empty signed-out cart does not show a load error", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByText("Unable to load your cart right now.")).toHaveCount(0);
});
