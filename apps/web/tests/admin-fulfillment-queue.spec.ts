import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { Capability } from "@freshmarkets/contracts";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

test.use({ timezoneId: "America/Los_Angeles" });

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    stackUp = (await request.get("/")).status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(() => {
  test.skip(!stackUp, "Local Web/Core stack is required for Fulfillment acceptance.");
});

const locationId = "location-cebu-central";
const timing = {
  cycleName: null,
  windowName: null,
  startsAt: null,
  endsAt: null,
  pickupAt: null,
  timezone: "Asia/Manila",
};

function order(number: string, status: string, name: string) {
  return {
    orderId: `order-${number}`,
    cycleId: null,
    locationId,
    status,
    version: 1,
    allowedActions: status === "NOT_STARTED" ? ["START_PICKING"] : ["MARK_READY_TO_PACK"],
    operational: {
      orderNumber: `FM-${number}`,
      committedAt: "2026-09-22T01:00:00.000Z",
      fulfillmentMode: "INSTANT",
      progress: status === "NOT_STARTED" ? "NEW" : "PREPARING",
      recipient: { name, phone: "+639170000000" },
      timing,
      deliveryStatus: null,
      blockers: [],
      lines: [
        {
          lineId: `line-${number}`,
          source: "ORIGINAL",
          productName: "Tomato",
          variantName: "Roma",
          unit: "kg",
          quantity: number === "Q1" ? 2 : 3,
          baseQuantity: 2000,
          baseUnit: "GRAM",
          goods: {
            kind: "INSTANT_RESERVATION",
            status: "RESERVED",
            allocatedBase: 2000,
            receivedBase: null,
          },
        },
      ],
    },
  };
}

async function bootstrap(
  page: Page,
  capabilities: Capability[] = ["fulfillment.read", "fulfillment.manage"],
) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-queue",
      displayName: "Queue Staff",
      email: "queue@example.com",
      capabilities,
      scopes: [{ kind: "location", locationId }],
      navigation: [],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-e2e",
        marketCode: "CEBU",
        locationId,
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope: { kind: "LOCATION", marketId: "market-e2e", locationId },
    timezone: "Asia/Manila",
  });
  await page.route("**/api/admin/operations-activity**", (route) =>
    route.fulfill({
      json: { ok: true, requestId: "activity", value: { notifications: [], latest: null } },
    }),
  );
}

test("Fulfillment views use Core filters, keep keyboard selection and honor deep links", async ({
  page,
}) => {
  await bootstrap(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const queries: URLSearchParams[] = [];
  await page.route("**/api/admin/fulfillment?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    const items =
      query.has("orderId") || query.has("cycleId")
        ? [order("Q2", "PICKING", "Bea")]
        : query.get("filter") === "ALL"
          ? [order("Q1", "NOT_STARTED", "Ana"), order("Q2", "PICKING", "Bea")]
          : query.get("filter") === "NEW"
            ? [order("Q1", "NOT_STARTED", "Ana")]
            : query.get("filter") === "PREPARING"
              ? [order("Q2", "PICKING", "Bea")]
              : [];
    await route.fulfill({
      json: { ok: true, requestId: "queue-read", value: { items, nextCursor: null } },
    });
  });

  await page.goto("/admin/fulfillment");
  await expect(page.getByRole("heading", { name: "Preparation queue" })).toBeVisible();
  await expect(page.getByRole("row", { name: /FM-Q1/ })).toContainText("Ana");
  await expect(page.getByRole("row", { name: /FM-Q1/ })).toContainText("2 kg Tomato");
  await expect(page.getByRole("complementary", { name: "Order FM-Q1 details" })).toContainText(
    "Sep 22, 2026, 9:00 AM Asia/Manila",
  );
  await page.screenshot({
    path: resolve(
      process.cwd(),
      "../../docs/operations/checkpoints/evidence/saui-07/fulfillment-queue-1440.png",
    ),
    mask: [page.getByText("+639170000000", { exact: true })],
    maskColor: "#f9fafb",
  });
  await page.getByRole("button", { name: "FM-Q2" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Order FM-Q2" })).toBeVisible();

  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("row", { name: /FM-Q1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /FM-Q2/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Preparing", exact: true }).click();
  await expect(page.getByRole("row", { name: /FM-Q2/ })).toBeVisible();
  const readsBeforeRefresh = queries.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => queries.length).toBeGreaterThan(readsBeforeRefresh);
  expect(queries.at(-1)?.get("filter")).toBe("PREPARING");
  await expect(page.getByRole("heading", { name: "Order FM-Q2" })).toBeVisible();
  await page.getByRole("button", { name: "Upcoming Scheduled" }).click();
  await expect(page.getByRole("heading", { name: "No orders in this view" })).toBeVisible();
  expect(queries.map((query) => query.get("filter"))).toEqual(
    expect.arrayContaining(["ALL", "NEW", "PREPARING", "UPCOMING"]),
  );
  expect(queries.every((query) => query.get("locationId") === locationId)).toBe(true);

  await page.goto("/admin/fulfillment?orderId=order-Q2&cycleId=cycle-Q2");
  await expect(page.getByRole("heading", { name: "Order FM-Q2" })).toBeVisible();
  expect(queries.at(-1)?.get("orderId")).toBe("order-Q2");
  expect(queries.at(-1)?.get("cycleId")).toBe("cycle-Q2");
  await page.goto("/admin/fulfillment?cycleId=cycle-Q2");
  await expect(page.getByText("Delivery week cycle-Q2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Show all fulfillment work" })).toBeVisible();
  await expect(page.getByRole("row", { name: /FM-Q2/ })).toBeVisible();
  expect(queries.at(-1)?.get("cycleId")).toBe("cycle-Q2");
});

test("selected-location queue reads Core and denied staff cannot read it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  await adminPage.goto("/admin/fulfillment");
  const scope = adminPage.getByRole("combobox", { name: "Active admin scope" });
  if ((await scope.evaluate((control) => control.tagName)) === "SELECT") {
    await scope.selectOption({ label: "Central Cebu" });
  } else {
    await scope.click();
    await adminPage.getByRole("option", { name: "Central Cebu" }).click();
  }
  const authorized = await adminPage.request.get(
    `/api/admin/fulfillment?locationId=${locationId}&filter=ALL&limit=1`,
  );
  expect(await authorized.json()).toMatchObject({ ok: true, value: { items: expect.any(Array) } });
  const denied = await deniedAdminPage.request.get(
    `/api/admin/fulfillment?locationId=${locationId}&filter=ALL&limit=1`,
  );
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

test("a slow older filter cannot replace a newer view; error retains request reference", async ({
  page,
}) => {
  await bootstrap(page);
  let historyFailures = 0;
  await page.route("**/api/admin/fulfillment?**", async (route) => {
    const filter = new URL(route.request().url()).searchParams.get("filter");
    if (filter === "NEW") await new Promise((resolve) => setTimeout(resolve, 700));
    if (filter === "HISTORY" && historyFailures++ === 0) {
      await route.fulfill({
        json: {
          ok: false,
          error: { code: "UNAVAILABLE", message: "History unavailable", requestId: "history-ref" },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        requestId: "queue-read",
        value: {
          items: filter === "PREPARING" ? [order("Q2", "PICKING", "Bea")] : [],
          nextCursor: null,
        },
      },
    });
  });

  await page.goto("/admin/fulfillment");
  await expect(page.getByRole("heading", { name: "No orders in this view" })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Preparing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order FM-Q2" })).toBeVisible();
  await page.waitForTimeout(850);
  await expect(page.getByRole("button", { name: "Preparing", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Order FM-Q2" })).toBeVisible();

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("history-ref");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No orders in this view" })).toBeVisible();
});

test("read-only Fulfillment staff see the checklist without mutation controls", async ({
  page,
}) => {
  await bootstrap(page, ["fulfillment.read"]);
  await page.route("**/api/admin/fulfillment?**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        requestId: "read-only",
        value: { items: [order("Q1", "NOT_STARTED", "Ana")], nextCursor: null },
      },
    }),
  );
  await page.goto("/admin/fulfillment");
  await expect(page.getByRole("heading", { name: "Ordered item checklist" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Order FM-Q1 details" }).getByRole("button"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Order FM-Q1 details" }).getByRole("textbox"),
  ).toHaveCount(0);
});

test("unknown and reconciling preparation responses retry one exact Core intent", async ({
  page,
}) => {
  await bootstrap(page);
  let status = "NOT_STARTED";
  await page.route("**/api/admin/fulfillment?**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        requestId: "queue",
        value: {
          items: [order("Q1", status, "Ana"), order("Q2", "PICKING", "Bea")],
          nextCursor: null,
        },
      },
    }),
  );
  const attempts: Array<{ key: string | undefined; body: string | null }> = [];
  await page.route("**/api/admin/fulfillment", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length === 1) {
      await route.abort("failed");
    } else if (attempts.length === 2) {
      await route.fulfill({
        json: {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Still reconciling",
            requestId: "conflict",
            details: { outcome: "RECONCILIATION_PENDING" },
          },
        },
      });
    } else {
      status = "PICKING";
      await route.fulfill({
        json: {
          ok: true,
          requestId: "confirmed",
          value: { orderId: "order-Q1", status: "PICKING", version: 2 },
        },
      });
    }
  });

  await page.goto("/admin/fulfillment");
  await page
    .getByRole("complementary", { name: "Order FM-Q1 details" })
    .getByRole("button", { name: "Accept order & start picking" })
    .click();
  await expect(page.getByText("Preparation action awaiting confirmation")).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "FM-Q2" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(page.getByText(/original action is still being reconciled/)).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Order FM-Q1 details" })
      .getByRole("button", { name: "Finish picking" }),
  ).toBeVisible();
  expect(attempts).toHaveLength(3);
  expect(
    attempts.every(
      (attempt) => attempt.key === attempts[0].key && attempt.body === attempts[0].body,
    ),
  ).toBe(true);
  expect(JSON.parse(attempts[0].body ?? "null")).toMatchObject({
    locationId,
    orderId: "order-Q1",
    action: "START_PICKING",
    expectedVersion: 1,
  });
});

test("a stale preparation rejection refreshes Core state without submitting a replacement", async ({
  page,
}) => {
  await bootstrap(page);
  let status = "NOT_STARTED";
  await page.route("**/api/admin/fulfillment?**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        requestId: "queue",
        value: { items: [order("Q1", status, "Ana")], nextCursor: null },
      },
    }),
  );
  let posts = 0;
  await page.route("**/api/admin/fulfillment", (route) => {
    posts += 1;
    status = "PICKING";
    return route.fulfill({
      json: {
        ok: false,
        error: {
          code: "STALE_VERSION",
          message: "Fulfillment changed; refresh before retrying",
          requestId: "stale",
        },
      },
    });
  });
  await page.goto("/admin/fulfillment");
  await page
    .getByRole("complementary", { name: "Order FM-Q1 details" })
    .getByRole("button", { name: "Accept order & start picking" })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Order FM-Q1 details" })
      .getByRole("button", { name: "Finish picking" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fulfillment changed; refresh before retrying", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
});

test("a shortage draft does not become the audit reason for a normal preparation action", async ({
  page,
}) => {
  await bootstrap(page);
  let body: Record<string, unknown> | null = null;
  await page.route("**/api/admin/fulfillment?**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        requestId: "queue",
        value: {
          items: [
            {
              ...order("Q1", "PICKING", "Ana"),
              allowedActions: ["MARK_READY_TO_PACK", "RECORD_SHORTAGE"],
            },
          ],
          nextCursor: null,
        },
      },
    }),
  );
  await page.route("**/api/admin/fulfillment", async (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        ok: true,
        requestId: "saved",
        value: { orderId: "order-Q1", status: "READY_TO_PACK", version: 2 },
      },
    });
  });
  await page.goto("/admin/fulfillment");
  const detail = page.getByRole("complementary", { name: "Order FM-Q1 details" });
  await detail.getByRole("textbox", { name: "Optional shortage reason" }).fill("Shortage draft");
  await detail.getByRole("button", { name: "Finish picking" }).click();
  await expect(page.getByText("Finish picking completed.")).toBeVisible();
  expect(body).toMatchObject({ action: "MARK_READY_TO_PACK" });
  expect(body).not.toHaveProperty("reason");
});
