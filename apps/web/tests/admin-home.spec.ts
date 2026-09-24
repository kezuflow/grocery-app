import type { AdminOverviewView } from "@freshmarkets/contracts";
import { expect, test } from "./admin-authenticated-fixture";

const updatedAt = "2026-09-25T01:00:00.000Z";

function overview(
  scope: AdminOverviewView["selectedScope"],
  exceptionValue: number | null = 2,
): AdminOverviewView {
  const global = scope.kind === "GLOBAL";
  return {
    selectedScope: scope,
    timezone: "Asia/Manila",
    generatedAt: updatedAt,
    freshness: { computedAt: updatedAt, sourceWatermark: null },
    notifications: [],
    cards: [
      {
        code: "OPEN_ORDERS",
        label: "Open orders",
        value: global ? 18 : null,
        unavailableReason: global ? null : "Global orders.read access is required.",
        href: "/admin/orders",
      },
      {
        code: "PAYMENT_ATTENTION",
        label: "Payments needing attention",
        value: global ? 3 : null,
        unavailableReason: global ? null : "Global payments.read access is required.",
        href: "/admin/payments?tab=attention",
      },
      {
        code: "OPEN_EXCEPTIONS",
        label: "Open exceptions",
        value: exceptionValue,
        unavailableReason:
          exceptionValue === null ? "fulfillment.manage access is required." : null,
        href: "/admin/issues/operational-exceptions",
      },
      {
        code: "ACTIVE_PRODUCTS",
        label: "Active products",
        value: global ? 226 : null,
        unavailableReason: global ? null : "Global catalog.read access is required.",
        href: "/admin/catalog/products",
      },
    ],
    workloadStages: [{ code: "COMPLETED", label: "completed", count: 7 }],
    exceptions:
      exceptionValue === null
        ? []
        : [
            {
              kind: "DELIVERY_FAILED",
              source: "DELIVERY",
              severity: "HIGH",
              ageMinutes: 20,
              ownerId: null,
              referenceId: "home-exception-1",
              orderId: "home-order-1",
              locationId: "location-cebu-central",
              reason: "Delivery needs review",
              permittedActions: [],
              detail: "Delivery needs review.",
              href: "/admin/issues/operational-exceptions",
            },
          ],
    recentOperations: global
      ? [
          {
            auditEventId: "home-audit-1",
            action: "ORDER.COMMITTED",
            resourceType: "order",
            resourceId: "home-order-technical-id",
            occurredAt: updatedAt,
            actorId: null,
            marketId: "market-metro-cebu",
            locationId: "location-cebu-central",
            reason: null,
            correlationId: "home-request-1",
          },
        ]
      : [],
    deniedSections: global ? [] : ["orders", "payments", "catalog", "audit"],
  };
}

test("Global Home prioritizes real operational cards and authorized links", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/bootstrap?**", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      ok: boolean;
      value?: { overview?: AdminOverviewView | null };
    };
    if (payload.ok && payload.value) payload.value.overview = overview({ kind: "GLOBAL" });
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });
  await page.goto("/admin");
  const metrics = page.getByRole("region", { name: "Operational metrics" });
  await expect(metrics.getByText("Open exceptions")).toBeVisible();
  await expect(metrics.getByText("Open orders")).toBeVisible();
  await expect(metrics.getByText("Payments needing attention")).toBeVisible();
  await expect(metrics.getByText("Active products")).toBeVisible();
  await expect(metrics.getByRole("link", { name: "Open workspace" })).toHaveCount(3);
  await expect(
    metrics.getByText("Select a location in the header or below to inspect its queue."),
  ).toBeVisible();
  await expect(page.getByText("Fulfillment by status", { exact: true })).toBeVisible();
  await expect(page.getByText("Record counts include completed stages.")).toBeVisible();
  await expect(
    page.getByText("Select a location in the queue to inspect its exceptions."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Select location" })).toBeVisible();
  const technicalDetails = page.getByText("Technical details", { exact: true });
  await expect(page.getByText("order · home-order-technical-id")).toBeHidden();
  await technicalDetails.click();
  await expect(page.getByText("order · home-order-technical-id")).toBeVisible();
  const metricTop = (await metrics.boundingBox())?.y ?? 0;
  const notificationTop = (await page.locator("#notifications").boundingBox())?.y ?? 0;
  expect(metricTop).toBeLessThan(notificationTop);
  await page.screenshot({
    path: "../../docs/operations/checkpoints/evidence/saui-10/home-global-1440.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Select location" }).click();
  await expect(page.getByRole("combobox", { name: "Active admin scope" })).toContainText(
    "Central Cebu",
  );
  await page
    .getByRole("region", { name: "Operational metrics" })
    .getByRole("link", { name: "Open workspace" })
    .click();
  await expect(page).toHaveURL(/\/admin\/issues\/operational-exceptions$/);
  await expect(page.getByText("Select a permitted location")).toHaveCount(0);
});

test("Home clears Global figures on location switch and omits unavailable links", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/bootstrap?**", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      ok: boolean;
      value?: { overview?: AdminOverviewView | null };
    };
    if (payload.ok && payload.value) payload.value.overview = overview({ kind: "GLOBAL" });
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });
  let releaseLocation!: () => void;
  const heldLocation = new Promise<void>((resolve) => (releaseLocation = resolve));
  let locationStarted!: () => void;
  const started = new Promise<void>((resolve) => (locationStarted = resolve));
  let locationReadCount = 0;
  await page.route("**/api/admin/overview?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("scopeKind") !== "LOCATION") return route.continue();
    locationReadCount += 1;
    if (locationReadCount === 1) {
      locationStarted();
      await heldLocation;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "home-location",
        value: overview(
          {
            kind: "LOCATION",
            marketId: query.get("marketId") ?? "market-metro-cebu",
            locationId: query.get("locationId") ?? "location-cebu-central",
          },
          locationReadCount === 1 ? null : 2,
        ),
      }),
    });
  });
  await page.goto("/admin");
  await expect(page.getByText("Open orders", { exact: true })).toBeVisible();
  const selector = page.getByRole("combobox", { name: "Active admin scope" });
  await selector.click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await started;
  await expect(page.getByText("Open orders", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Payments needing attention", { exact: true })).toHaveCount(0);
  releaseLocation();
  const metrics = page.getByRole("region", { name: "Operational metrics" });
  await expect(metrics.getByText("Open exceptions")).toBeVisible();
  await expect(metrics.getByRole("link", { name: "Open workspace" })).toHaveCount(0);
  await expect(page.getByText("fulfillment.manage access is required.")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open fulfillment" })).toHaveAttribute(
    "href",
    "/admin/fulfillment",
  );
  await expect(
    page.getByText("Material operations are outside your current access."),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/operations/checkpoints/evidence/saui-10/home-location-1440.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(metrics.getByRole("link", { name: "Open workspace" })).toHaveCount(1);
  await expect(metrics.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByText("fulfillment.manage access is required.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open delivery failed exception" })).toBeVisible();
  await expect(metrics.getByText("Open orders")).toHaveCount(0);
  await page.screenshot({
    path: "../../docs/operations/checkpoints/evidence/saui-10/home-location-active-1440.png",
    fullPage: true,
  });
});

test("local read-only Home links fulfillment without offering exception actions", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/bootstrap?**", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      ok: boolean;
      value?: {
        context: {
          capabilities: string[];
          navigation: Array<{ code: string; href: string; scopeKinds: string[] }>;
        };
        scopes: Array<{ kind: string; marketId: string; locationId?: string }>;
        selection: { selectedScope: AdminOverviewView["selectedScope"] | null };
        overview: AdminOverviewView | null;
      };
    };
    if (payload.ok && payload.value) {
      const location = payload.value.scopes.find(
        (option) => option.kind === "location" && option.locationId === "location-cebu-central",
      );
      if (!location?.locationId) throw new Error("Missing local scope fixture");
      const selectedScope = {
        kind: "LOCATION" as const,
        marketId: location.marketId,
        locationId: location.locationId,
      };
      payload.value.context.capabilities = ["fulfillment.read"];
      payload.value.context.navigation = payload.value.context.navigation.filter((item) =>
        ["overview", "fulfillment"].includes(item.code),
      );
      payload.value.selection.selectedScope = selectedScope;
      payload.value.overview = overview(selectedScope, null);
    }
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });
  await page.goto("/admin");
  await expect(page.getByText("At this location")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open fulfillment" })).toHaveAttribute(
    "href",
    "/admin/fulfillment",
  );
  await expect(
    page.getByRole("region", { name: "Operational metrics" }).getByRole("link"),
  ).toHaveCount(0);
  await expect(page.getByText("fulfillment.manage access is required.")).toBeVisible();
});
