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
  await expect(firstHillsRow).toContainText("Courier action unavailable");
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
  await page.getByRole("button", { name: "Review assign manual delivery" }).click();
  await expect(page.getByRole("dialog")).toContainText("Test rider");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
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

test("Scheduled dispatch chooses a Core-permitted method, reviews manual assignment, and shows saved evidence at 1440px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDeliveryScopes(page);
  let assigned = false;
  const requests: string[] = [];
  await page.route("**/api/admin/delivery?**", (route) => {
    const item = {
      ...deliveryItem(firstLocation, "scheduled-choice", "SCHEDULED"),
      status: assigned ? "ASSIGNED" : "UNASSIGNED",
      courierPickup: assigned
        ? { allowedKinds: [], unavailableReason: "Delivery is assigned" }
        : { allowedKinds: ["IMMEDIATE", "SCHEDULED"], unavailableReason: null },
      manualActions: assigned ? ["HAND_OVER", "FAIL"] : ["ASSIGN"],
      manualDelivery: assigned
        ? {
            dispatchId: "manual-saved",
            personName: "Dispatch helper",
            phoneE164: "+639171110000",
            selectionReason: "STAFF_SELECTED_MANUAL",
            note: "Local team",
            status: "ACTIVE",
            handedOverAt: null,
            returnInspectedAt: null,
            actualCostMinor: null,
            currency: "PHP",
            version: 1,
          }
        : null,
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: { ...deliveryPage(firstLocation, "scheduled-choice").value, items: [item] },
      }),
    });
  });
  await page.route("**/api/admin/manual-deliveries", (route) => {
    requests.push(route.request().postData() ?? "");
    assigned = true;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          dispatchId: "manual-saved",
          jobId: "job-scheduled-choice",
          status: "ACTIVE",
          version: 1,
        },
      }),
    });
  });
  await page.goto("/admin/delivery");
  const row = page.getByRole("row", { name: /scheduled-choice/ });
  await expect(row.getByRole("region", { name: "Choose dispatch method" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Review Lalamove booking" })).toHaveCount(0);
  await row.getByRole("button", { name: "Request Lalamove" }).click();
  await expect(row.getByText("Request a driver now", { exact: true })).toBeVisible();
  await expect(row.getByText("Schedule pickup")).toBeVisible();
  await row.getByRole("button", { name: "Review Lalamove booking" }).click();
  await expect(page.getByRole("dialog")).toContainText("fresh, short-lived courier quote");
  await expect(page.getByRole("dialog")).toContainText(
    "customer’s delivery charge does not change",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await row.getByRole("button", { name: "Assign manual rider" }).click();
  await expect(row.getByRole("textbox", { name: "Person delivering" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Request Lalamove" })).toBeEnabled();
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath("dispatch-choice-1440.png"), fullPage: true });
  await expect(row.getByRole("button", { name: "Request Lalamove" })).toBeEnabled();
  await row.getByRole("textbox", { name: "Person delivering" }).fill("Dispatch helper");
  await row.getByRole("textbox", { name: "Phone including country code" }).fill("+639171110000");
  await row.getByRole("textbox", { name: "Operational note (optional)" }).fill("Local team");
  await row.getByRole("button", { name: "Review assign manual delivery" }).click();
  await expect(page.getByRole("dialog")).toContainText("Dispatch helper");
  expect(requests).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(JSON.parse(requests[0]!)).toMatchObject({
    action: "ASSIGN",
    personName: "Dispatch helper",
    note: "Local team",
  });
  await expect(row.getByText("Selection reason: Staff chose manual delivery")).toBeVisible();
  await expect(row.getByText("Result: active")).toBeVisible();
  await expect(row.getByRole("button", { name: "Hand over packed order" })).toBeVisible();
  await row.getByRole("button", { name: "Record delivery failure" }).click();
  await row.getByRole("textbox", { name: "What went wrong" }).fill("Local test failure");
  await row.getByRole("textbox", { name: "Actual delivery cost (PHP)" }).fill("1.234");
  await row.getByRole("button", { name: "Review record delivery failure" }).click();
  await expect(
    row.getByText("Enter a non-negative cost with at most two decimal places"),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test("Instant first booking remains automatic and persisted courier amounts are distinct", async ({
  page,
}) => {
  await installDeliveryScopes(page);
  await page.route("**/api/admin/delivery?**", (route) => {
    const pending = {
      ...deliveryItem(firstLocation, "instant-pending", "INSTANT"),
      courierPickup: { allowedKinds: [], unavailableReason: "Automatic booking in progress" },
    };
    const quoted = {
      ...deliveryItem(firstLocation, "courier-quoted", "SCHEDULED"),
      externalDispatch: {
        dispatchId: "courier-quote",
        provider: "lalamove",
        status: "ACTIVE",
        providerStatus: "ALLOCATING",
        trackingUrl: null,
        providerDeliveryId: "provider-quote",
        quoteAmountMinor: 4200,
        quoteCurrency: "PHP",
        actualCostMinor: 4300,
        costCurrency: "PHP",
        version: 2,
      },
    };
    const completed = {
      ...deliveryItem(firstLocation, "manual-complete", "SCHEDULED"),
      status: "DELIVERED",
      deliveredAtIso: "2026-09-24T08:00:00.000Z",
      manualDelivery: {
        dispatchId: "manual-complete",
        personName: "Test helper",
        phoneE164: "+639171110000",
        selectionReason: "STAFF_SELECTED_MANUAL",
        note: "Recorded by staff",
        status: "COMPLETED",
        handedOverAt: Date.parse("2026-09-24T07:00:00.000Z"),
        returnInspectedAt: null,
        actualCostMinor: 1750,
        currency: "PHP",
        version: 3,
      },
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          ...deliveryPage(firstLocation, "instant-pending").value,
          items: [pending, quoted, completed],
        },
      }),
    });
  });
  await page.goto("/admin/delivery");
  const instant = page.getByRole("row", { name: /instant-pending/ });
  await expect(instant).toContainText("Automatic Lalamove booking pending");
  await expect(instant.getByRole("region", { name: "Choose dispatch method" })).toHaveCount(0);
  await expect(instant.getByRole("button", { name: "Review Lalamove booking" })).toHaveCount(0);
  const quoted = page.getByRole("row", { name: /courier-quoted/ });
  await expect(quoted).toContainText("Provider quote: PHP 42.00");
  await expect(quoted).toContainText("Courier cost: PHP 43.00");
  const manual = page.getByRole("row", { name: /manual-complete/ });
  await expect(manual).toContainText("Selection reason: Staff chose manual delivery");
  await expect(manual).toContainText("Handed over:");
  await expect(manual).toContainText("Result: completed");
  await expect(manual).toContainText("Actual cost: PHP 17.50");
  await expect(manual).toContainText("Delivered:");
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
  await page.getByRole("button", { name: "Review assign manual delivery" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: "Retry saved request" })).toBeVisible();
  releaseOlderRead();
  await expect(page.getByRole("button", { name: "Retry saved request" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Order stale-or" })).toBeVisible();
});

test("Provider cancellation asks accessibly and retries one saved request after an unknown result", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDeliveryScopes(page);
  await page.route("**/api/admin/delivery?**", (route) => {
    const item = {
      ...deliveryItem(firstLocation, "cancel-order", "SCHEDULED"),
      externalDispatch: {
        dispatchId: "cancel-dispatch",
        provider: "lalamove",
        status: "ACTIVE",
        providerStatus: "PENDING_PICKUP",
        trackingUrl: null,
        providerDeliveryId: "provider-cancel",
        version: 4,
      },
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: { ...deliveryPage(firstLocation, "cancel-order", "next").value, items: [item] },
      }),
    });
  });
  const requests: { key: string | undefined; body: string | null; url: string }[] = [];
  let releaseFirst!: () => void;
  const heldFirst = new Promise<void>((resolve) => (releaseFirst = resolve));
  await page.route("**/api/admin/external-deliveries/cancel-dispatch/cancel", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
      url: route.request().url(),
    });
    if (requests.length === 1) {
      await heldFirst;
      return route.abort("failed");
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: { status: "CANCELED" } }),
    });
  });
  await page.goto("/admin/delivery");
  const cancel = page
    .getByRole("row", { name: /cancel-order/ })
    .getByRole("button", { name: "Cancel" });
  await cancel.click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel Lalamove delivery?" });
  await expect(dialog).toContainText("Order cancel-order");
  await page.waitForTimeout(250);
  await page.screenshot({
    path: testInfo.outputPath("delivery-cancel-dialog-1440.png"),
    fullPage: true,
  });
  expect(requests).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(cancel).toBeFocused();
  await cancel.click();
  await dialog.getByRole("button", { name: "Request cancellation" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(JSON.parse(requests[0]!.body!)).toEqual({
    locationId: firstLocation,
    expectedVersion: 4,
  });
  await expect(dialog.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseFirst();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry saved cancellation" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Results pagination" })
      .getByRole("button", { name: "Next" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry saved cancellation" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("Delivery pagination asks before discarding a manual draft and restores focus", async ({
  page,
}) => {
  await installDeliveryScopes(page);
  await page.route("**/api/admin/delivery?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const item = cursor
      ? deliveryItem(firstLocation, "second-draft-page", "SCHEDULED")
      : {
          ...deliveryItem(firstLocation, "first-draft-page", "SCHEDULED"),
          manualActions: ["ASSIGN"],
        };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          ...deliveryPage(firstLocation, item.orderId, cursor ? null : "next").value,
          items: [item],
        },
      }),
    });
  });
  await page.goto("/admin/delivery");
  await page.getByRole("button", { name: "Assign manual delivery" }).click();
  await page.getByRole("textbox", { name: "Person delivering" }).fill("Draft rider");
  const next = page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" });
  await next.click();
  const dialog = page.getByRole("alertdialog", { name: "Discard delivery draft?" });
  await expect(dialog).toContainText("Unsaved delivery form entries");
  await dialog.getByRole("button", { name: "Keep draft" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(next).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Person delivering" })).toHaveValue("Draft rider");
  await next.click();
  await dialog.getByRole("button", { name: "Discard and change page" }).click();
  await expect(page.getByRole("link", { name: "Order second-d" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Delivery" })).toBeFocused();
});
