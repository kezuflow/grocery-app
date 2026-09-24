import type { Page } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

const central = "location-cebu-central";
const harbor = "location-cebu-harbor";

async function bootstrap(page: Page) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-receiving-presentation",
      displayName: "Receiving operator",
      email: "receiving@example.com",
      capabilities: ["procurement.manage"],
      scopes: [
        { kind: "location", locationId: central },
        { kind: "location", locationId: harbor },
      ],
      navigation: [
        {
          code: "receiving",
          label: "Receiving",
          href: "/admin/receiving",
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

function receipt(locationId: string, name: string) {
  return {
    receivingSessionId: `session-${name.toLowerCase().replaceAll(" ", "-")}`,
    requirementId: `requirement-${name.toLowerCase().replaceAll(" ", "-")}`,
    cycleId: "cycle-receiving",
    locationId,
    expectedBase: 1000,
    acceptedBase: 250,
    rejectedBase: 100,
    shortageBase: 50,
    replacementBase: 0,
    status: "IN_PROGRESS",
    version: 2,
    productName: name,
    variantName: "500 g",
    cycleName: "September delivery",
    baseUnit: "GRAM",
    allowedActions: ["RECORD"],
  };
}

test("Receiving keeps the current location and cursor while showing inspected quantities", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await bootstrap(page);
  const delayed: { release?: () => void } = {};
  const delayedCommand: { release?: () => void } = {};
  const requests: string[] = [];
  let centralFirstReads = 0;
  await page.route("**/api/admin/receiving?**", async (route) => {
    const url = new URL(route.request().url());
    const locationId = url.searchParams.get("locationId") ?? "";
    const cursor = url.searchParams.get("cursor");
    requests.push(`${locationId}:${cursor ?? "first"}`);
    if (locationId === central && !cursor) centralFirstReads += 1;
    if (locationId === harbor) {
      await new Promise<void>((resolve) => {
        delayed.release = resolve;
      });
    }
    try {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          requestId: "receiving-fixture",
          value: {
            items: [
              locationId === harbor
                ? receipt(harbor, "Harbor pepper")
                : cursor
                  ? receipt(central, "Second onion")
                  : { ...receipt(central, "First onion"), version: centralFirstReads + 1 },
            ],
            nextCursor: locationId === central && !cursor ? "second-page" : null,
          },
        }),
      });
    } catch {
      // Browser may cancel a superseded read.
    }
  });
  await page.route("**/api/admin/receiving/record-line", async (route) => {
    await new Promise<void>((resolve) => {
      delayedCommand.release = resolve;
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "record-fixture",
        value: { ...receipt(central, "First onion"), version: 3 },
      }),
    });
  });
  await page.goto("/admin/receiving?cycleId=cycle-receiving");
  const table = page.getByRole("table", { name: "Receiving sessions" });
  const first = table.getByRole("row").filter({ hasText: "First onion" });
  await expect(first).toBeVisible();
  await expect(first).toContainText("Expected: 1,000 g");
  await expect(first).toContainText("Accepted: 250 g");
  await expect(first).toContainText("Rejected: 100 g");
  await expect(first).toContainText("Missing: 50 g");
  await first.getByLabel("Accepted quantity session-first-onion").fill("600");
  await first.getByRole("button", { name: "Record line" }).click();
  await expect.poll(() => Boolean(delayedCommand.release)).toBe(true);
  await expect(
    page
      .getByRole("navigation", { name: "Results pagination" })
      .getByRole("button", { name: "Next" }),
  ).toBeDisabled();
  delayedCommand.release?.();
  await expect(first).toContainText("First onion");
  await first.getByLabel("Accepted quantity session-first-onion").fill("600");
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(table.getByRole("row").filter({ hasText: "Second onion" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Previous" })
    .click();
  await expect(first).toBeVisible();
  await expect(first.getByLabel("Accepted quantity session-first-onion")).toHaveValue("");
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(table.getByRole("row").filter({ hasText: "Second onion" })).toBeVisible();
  await page.getByRole("combobox", { name: "Active admin scope" }).click();
  await page.getByRole("option", { name: "Harbor Cebu", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: "Second onion" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading receiving" })).toBeVisible();
  await expect.poll(() => Boolean(delayed.release)).toBe(true);
  delayed.release?.();
  await expect(table.getByRole("row").filter({ hasText: "Harbor pepper" })).toBeVisible();
  expect(requests.at(-1)).toBe(`${harbor}:first`);
  await expect(page.getByRole("navigation", { name: "Results pagination" })).toContainText(
    "Page 1",
  );
  await page.screenshot({ path: testInfo.outputPath("receiving-harbor-1440.png"), fullPage: true });
});
