import type { Page } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

const central = "location-cebu-central";
const harbor = "location-cebu-harbor";

async function bootstrap(page: Page) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-inventory-presentation",
      displayName: "Inventory operator",
      email: "inventory@example.com",
      capabilities: ["inventory.read", "inventory.adjust"],
      scopes: [
        { kind: "location", locationId: central },
        { kind: "location", locationId: harbor },
      ],
      navigation: [
        {
          code: "inventory",
          label: "Inventory",
          href: "/admin/inventory",
          section: "products",
          scopeKinds: ["LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-cebu",
        marketCode: "CEBU",
        locationId: central,
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
      {
        kind: "location",
        marketId: "market-cebu",
        marketCode: "CEBU",
        locationId: harbor,
        locationCode: "HARBOR",
        locationName: "Harbor Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope: { kind: "LOCATION", marketId: "market-cebu", locationId: central },
    timezone: "Asia/Manila",
  });
}

function stock(locationId: string, name: string, unit: string) {
  return {
    locationId,
    inventoryPoolId: `pool-${name.toLowerCase()}`,
    productId: `product-${name.toLowerCase()}`,
    productName: name,
    skuId: null,
    stockKind: "SHARED",
    baseUnitSymbol: unit,
    onHandBase: 5000,
    reservedBase: 1000,
    heldBase: 250,
    availableBase: 3750,
    version: 1,
  };
}

test("Inventory separates stock meanings and hides old rows during cursor and scope reads", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrap(page);
  const delayed: { release?: () => void } = {};
  await page.route("**/api/admin/inventory?**", async (route) => {
    const url = new URL(route.request().url());
    const locationId = url.searchParams.get("locationId");
    const cursor = url.searchParams.get("cursor");
    if (locationId === harbor)
      await new Promise<void>((resolve) => {
        delayed.release = resolve;
      });
    try {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          value: {
            items: [
              locationId === harbor
                ? stock(harbor, "Harbor juice", "mL")
                : cursor
                  ? stock(central, "Second onion", "g")
                  : stock(central, "First onion", "g"),
            ],
            nextCursor: locationId === central && !cursor ? "second-page" : null,
          },
        }),
      });
    } catch {
      // The superseded scope request can be canceled by the browser.
    }
  });
  await page.route("**/api/admin/inventory/**/ledger?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          items: [
            {
              entryId: "ledger-hold",
              movementType: "CHECKOUT_HOLD",
              quantityDeltaBase: 0,
              reservationDeltaBase: 250,
              reasonCode: "CHECKOUT_PENDING",
              actorId: null,
              createdAt: "2026-09-24T12:00:00.000Z",
            },
          ],
          nextCursor: null,
        },
      }),
    }),
  );
  await page.goto("/admin/inventory");
  const table = page.getByRole("table", { name: "Stock levels" });
  const row = table.getByRole("row").filter({ hasText: "First onion" });
  await expect(row).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Physical" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Reserved" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Checkout holds" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Available" })).toBeVisible();
  await expect(row.locator("td").nth(1)).toContainText("5,000 g");
  await expect(row.locator("td").nth(2)).toContainText("1,000 g");
  await expect(row.locator("td").nth(3)).toContainText("250 g");
  await expect(row.locator("td").nth(4)).toContainText("3,750 g");
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(table.getByRole("row").filter({ hasText: "Second onion" })).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole("combobox", { name: "Active admin scope" }).click();
  await page.getByRole("option", { name: "Harbor Cebu", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: "Second onion" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading inventory" })).toBeVisible();
  await expect.poll(() => Boolean(delayed.release)).toBe(true);
  delayed.release?.();
  const harborRow = table.getByRole("row").filter({ hasText: "Harbor juice" });
  await expect(harborRow).toBeVisible();
  await expect(harborRow.locator("td").nth(4)).toContainText("3,750 mL");
  await expect(page.getByRole("navigation", { name: "Results pagination" })).toContainText(
    "Page 1",
  );
  await harborRow.getByRole("button", { name: "View activity" }).click();
  const activity = page.getByRole("table", { name: "Stock activity" });
  await expect(activity.getByRole("columnheader", { name: "Physical change" })).toBeVisible();
  await expect(
    activity.getByRole("columnheader", { name: "Reservation / hold change" }),
  ).toBeVisible();
  await expect(activity.locator("tbody tr").locator("td").nth(2)).toContainText("0 mL");
  await expect(activity.locator("tbody tr").locator("td").nth(3)).toContainText("+250 mL");
  await page.screenshot({ path: testInfo.outputPath("inventory-harbor-1440.png"), fullPage: true });
});
