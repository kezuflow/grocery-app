import type { Page } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

const firstLocation = "location-delivery-a";
const secondLocation = "location-delivery-b";

async function installDeliveryScopes(page: Page, canManage = true) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-delivery-e2e",
      displayName: "Delivery operator",
      email: "delivery@example.com",
      capabilities: canManage ? ["delivery.read", "delivery.manage"] : ["delivery.read"],
      scopes: [
        { kind: "location", locationId: firstLocation },
        { kind: "location", locationId: secondLocation },
      ],
      navigation: [
        {
          code: "delivery",
          label: "Delivery",
          href: "/admin/delivery",
          section: "orders",
          scopeKinds: ["LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    },
    scopes: [firstLocation, secondLocation].map((locationId, index) => ({
      kind: "location" as const,
      marketId: "market-e2e",
      marketCode: "CEBU",
      locationId,
      locationCode: index === 0 ? "A" : "B",
      locationName: index === 0 ? "Harbor" : "Hills",
      currency: "PHP",
      timezone: "Asia/Manila",
    })),
    selectedScope: { kind: "LOCATION", marketId: "market-e2e", locationId: firstLocation },
    timezone: "Asia/Manila",
  });
  await page.route("**/api/admin/operations-activity?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: { notifications: [], latest: null } }),
    }),
  );
}

function deliveryItem(locationId: string, orderId: string, mode: "INSTANT" | "SCHEDULED") {
  return {
    jobId: `job-${orderId}`,
    orderId,
    cycleId: mode === "INSTANT" ? null : "cycle-e2e",
    locationId,
    fulfillmentMode: mode,
    status: "UNASSIGNED",
    manualActions: [],
    canRevisePromise: false,
    canInspectReturnedGoods: false,
    courierPickup: { allowedKinds: [], unavailableReason: "Courier action unavailable" },
    manualDelivery: null,
    externalDispatch: null,
    deliveredAtIso: null,
    version: 1,
  };
}

function deliveryPage(locationId: string, orderId: string, nextCursor: string | null = null) {
  return {
    ok: true,
    value: {
      locationId,
      cycleId: null,
      status: "OPEN",
      totalOpenJobs: 2,
      bookedJobs: 0,
      items: [
        deliveryItem(locationId, orderId, locationId === firstLocation ? "INSTANT" : "SCHEDULED"),
      ],
      nextCursor,
    },
  };
}

test("Delivery queue isolates location reads and reaches later cursor pages at 1440px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDeliveryScopes(page);
  let releaseFirst!: () => void;
  let markFirst!: () => void;
  const heldFirst = new Promise<void>((resolve) => (releaseFirst = resolve));
  const firstRequested = new Promise<void>((resolve) => (markFirst = resolve));
  let firstHeld = false;
  await page.route("**/api/admin/delivery?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const locationId = params.get("locationId") ?? "";
    const cursor = params.get("cursor");
    if (locationId === firstLocation && !firstHeld) {
      firstHeld = true;
      markFirst();
      await heldFirst;
    }
    const body =
      locationId === firstLocation
        ? deliveryPage(locationId, "harbor-order")
        : cursor
          ? deliveryPage(locationId, "hills-later-order")
          : deliveryPage(locationId, "hills-first-order", "hills-next");
    try {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    } catch {
      // The first request may already be canceled by the scope switch.
    }
  });
  await page.goto("/admin/delivery");
  await firstRequested;
  const selector = page.getByRole("combobox", { name: "Active admin scope" });
  await selector.click();
  await page.getByRole("option", { name: "Hills", exact: true }).click();
  await expect(page.getByRole("link", { name: "Order hills-fi" })).toHaveAttribute(
    "href",
    "/admin/orders/hills-first-order",
  );
  const firstHillsRow = page.getByRole("row", { name: /hills-first-order/ });
  await expect(firstHillsRow).toContainText("Scheduled");
  await expect(firstHillsRow).toContainText("Awaiting assignment");
  releaseFirst();
  await expect(page.getByText("harbor-order", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("delivery-queue-1440.png"), fullPage: true });

  const pagination = page.getByRole("navigation", { name: "Results pagination" });
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("link", { name: "Order hills-la" })).toBeVisible();
  await expect(page.getByText("hills-first-order", { exact: true })).toHaveCount(0);
  await expect(pagination).toContainText("Page 2");
  await pagination.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("link", { name: "Order hills-fi" })).toBeVisible();

  await selector.click();
  await page.getByRole("option", { name: "Harbor", exact: true }).click();
  await expect(page.getByRole("link", { name: "Order harbor-o" })).toBeVisible();
  await expect(pagination).toContainText("Page 1");
  await expect(page.getByText("hills-first-order", { exact: true })).toHaveCount(0);
});

test("Delivery queue clears a recovered read error", async ({ page }) => {
  await installDeliveryScopes(page);
  let recover = false;
  await page.route("**/api/admin/delivery?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        !recover
          ? { ok: false, error: { message: "Synthetic read failure" } }
          : deliveryPage(firstLocation, "recovered-order"),
      ),
    });
  });
  await page.goto("/admin/delivery");
  await expect(page.getByText("Synthetic read failure", { exact: false })).toBeVisible();
  recover = true;
  await page.getByRole("button", { name: "Refresh delivery queue" }).click();
  await expect(page.getByRole("link", { name: "Order recovere" })).toBeVisible();
  await expect(page.getByText("Synthetic read failure", { exact: false })).toHaveCount(0);
});

test("Delivery queue reads the selected location from real Core", async ({ adminPage }) => {
  await adminPage.goto("/admin/delivery");
  const selector = adminPage.getByRole("combobox", { name: "Active admin scope" });
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Delivery" })).toBeVisible();
  const response = await adminPage.request.get(
    "/api/admin/delivery?locationId=location-cebu-central&limit=1",
  );
  expect(response.ok()).toBe(true);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    ok: true,
    value: { locationId: "location-cebu-central", items: expect.any(Array) },
  });
});

test("Unknown manual request retains its key and body across navigation and queue refresh", async ({
  page,
}) => {
  await installDeliveryScopes(page);
  await page.route("**/api/admin/delivery?**", (route) => {
    const item = {
      ...deliveryItem(firstLocation, "unknown-order", "SCHEDULED"),
      manualActions: ["ASSIGN"],
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...deliveryPage(firstLocation, "unknown-order", "next"),
        value: { ...deliveryPage(firstLocation, "unknown-order", "next").value, items: [item] },
      }),
    });
  });
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/admin/manual-deliveries", (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (requests.length === 1) return route.abort("failed");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: {} }),
    });
  });
  await page.goto("/admin/delivery");
  await page.getByRole("button", { name: "Assign manual delivery" }).click();
  await page.getByRole("textbox", { name: "Person delivering" }).fill("Test rider");
  await page.getByRole("textbox", { name: "Phone including country code" }).fill("+639171234567");
  await page.getByRole("button", { name: "Assign manual delivery" }).last().click();
  await expect(page.getByRole("button", { name: "Retry saved request" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Results pagination" })
      .getByRole("button", { name: "Next" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Order unknown-" }).click();
  await expect(page).toHaveURL(/\/admin\/delivery$/);
  await page.getByRole("button", { name: "Retry saved request" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("Read-only delivery staff cannot use provider recovery controls", async ({ page }) => {
  await installDeliveryScopes(page, false);
  await page.route("**/api/admin/delivery?**", (route) => {
    const item = {
      ...deliveryItem(firstLocation, "readonly-order", "INSTANT"),
      externalDispatch: {
        dispatchId: "dispatch-readonly",
        provider: "grab-express",
        status: "ACTIVE",
        providerStatus: "ALLOCATING",
        trackingUrl: null,
        providerDeliveryId: "provider-readonly",
        version: 1,
      },
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: { ...deliveryPage(firstLocation, "readonly-order").value, items: [item] },
      }),
    });
  });
  await page.goto("/admin/delivery");
  await expect(page.getByText("GrabExpress · Finding rider")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh provider" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
});

test("An older queue read cannot unmount an unknown manual request", async ({ page }) => {
  await installDeliveryScopes(page);
  let queueReads = 0;
  let releaseOlderRead!: () => void;
  let markOlderRead!: () => void;
  const olderReadHeld = new Promise<void>((resolve) => (releaseOlderRead = resolve));
  const olderReadStarted = new Promise<void>((resolve) => (markOlderRead = resolve));
  await page.route("**/api/admin/delivery?**", async (route) => {
    queueReads += 1;
    if (queueReads > 1) {
      markOlderRead();
      await olderReadHeld;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          value: { ...deliveryPage(firstLocation, "stale-order").value, items: [] },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          ...deliveryPage(firstLocation, "stale-order").value,
          items: [
            {
              ...deliveryItem(firstLocation, "stale-order", "SCHEDULED"),
              manualActions: ["ASSIGN"],
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/admin/manual-deliveries", (route) => route.abort("failed"));
  await page.goto("/admin/delivery");
  await expect(page.getByRole("button", { name: "Assign manual delivery" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await olderReadStarted;
  await page.getByRole("button", { name: "Assign manual delivery" }).click();
  await page.getByRole("textbox", { name: "Person delivering" }).fill("Test rider");
  await page.getByRole("textbox", { name: "Phone including country code" }).fill("+639171234567");
  await page.getByRole("button", { name: "Assign manual delivery" }).last().click();
  await expect(page.getByRole("button", { name: "Retry saved request" })).toBeVisible();
  releaseOlderRead();
  await expect(page.getByRole("button", { name: "Retry saved request" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Order stale-or" })).toBeVisible();
});
