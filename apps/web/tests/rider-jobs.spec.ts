import { expect, test } from "@playwright/test";

/**
 * Rider console flow against a provisioned local stack. Skips when the app
 * is unreachable so repository verification stays environment-safe.
 * Authenticated journeys additionally require a configured development
 * auth-email transport (E2E_AUTH_EMAIL_CONFIGURED=1).
 */
const authEmailConfigured = process.env.E2E_AUTH_EMAIL_CONFIGURED === "1";

const instructions = {
  buildingUnit: "Unit 4B",
  landmark: "Orange gate",
  gateGuard: "Ask for Mina",
  deliveryNote: "Keep produce upright",
  recipientInstruction: "Call on arrival",
};

function delivery(jobId: string, sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    jobId,
    stopId: `stop-${jobId}`,
    orderId: `order-${jobId}`,
    sequence,
    status: "ASSIGNED",
    destination: {
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
      displayAddress: `${jobId} Mango Avenue, Cebu City, PH`,
      recipient: `Recipient ${jobId}`,
      phone: `0917000${sequence}`,
      instructions,
    },
    jobVersion: 7,
    stopVersion: 4,
    allowedActions: ["MARK_EN_ROUTE"],
    ...overrides,
  };
}

type RiderDeliveryFixture = ReturnType<typeof delivery>;

function batchValue(
  currentDelivery: RiderDeliveryFixture | null,
  upcomingDeliveries: RiderDeliveryFixture[] = [],
) {
  return {
    batches: [
      {
        batchId: "batch-1",
        locationId: "location-1",
        fulfillmentMode: "INSTANT",
        cycleId: null,
        status: "IN_PROGRESS",
        version: 3,
        currentDelivery,
        upcomingDeliveries,
      },
    ],
  };
}

async function mockRiderBatches(
  page: import("@playwright/test").Page,
  values: Array<ReturnType<typeof batchValue>>,
) {
  let readIndex = 0;
  await page.route("**/api/rider/batches", async (route) => {
    const value = values[Math.min(readIndex, values.length - 1)]!;
    readIndex += 1;
    await route.fulfill({ json: { ok: true, value, requestId: `read-${readIndex}` } });
  });
}

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

async function signUpRider(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const email = `rider-e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: {
      "content-type": "application/json",
      origin: process.env.APP_BASE_URL ?? "http://localhost:3000",
    },
    data: { name: "Rider E2E", email, password: "correct-horse-battery-staple" },
  });
  expect([200, 201]).toContain(signUp.status());
}

test("an unauthenticated rider is told to sign in", async ({ page }) => {
  await page.goto("/rider");
  await expect(page.getByRole("alert")).toContainText("Sign in with your rider account");
});

test("a signed-in rider with no assignments sees the explicit empty state", async ({ page }) => {
  test.skip(!authEmailConfigured, "Signup verification needs a configured auth-email transport.");
  await signUpRider(page.request);
  await page.goto("/rider");
  await expect(page.getByText(/no delivery batches are assigned to you/i)).toBeVisible();
});

test("the current delivery shows immutable details, ordered stops, safe navigation, and Core actions", async ({
  page,
}) => {
  const current = delivery("current", 2, {
    allowedActions: ["MARK_ARRIVED", "MARK_FAILED"],
  });
  const upcoming = [
    delivery("third", 3, { allowedActions: [] }),
    delivery("fifth", 5, { allowedActions: [] }),
  ];
  await mockRiderBatches(page, [batchValue(current, upcoming)]);

  await page.goto("/rider");

  const currentCard = page.getByTestId("current-delivery");
  await expect(currentCard).toContainText("current Mango Avenue, Cebu City, PH");
  await expect(currentCard).toContainText("Recipient current");
  await expect(currentCard).toContainText("09170002");
  await expect(currentCard).toContainText("Keep produce upright");
  await expect(page.getByTestId("upcoming-delivery")).toHaveText([
    /Stop 3.*third Mango Avenue/s,
    /Stop 5.*fifth Mango Avenue/s,
  ]);
  const navigate = currentCard.getByRole("link", { name: "Navigate" });
  await expect(navigate).toHaveAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=10.3157%2C123.8854&travelmode=driving&dir_action=navigate",
  );
  await expect(navigate).toHaveAttribute("target", "_blank");
  await expect(navigate).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("button", { name: "Arrived" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Failed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "En Route" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delivered" })).toHaveCount(0);
});

test("a successful lifecycle action refreshes and advances to the authoritative next delivery", async ({
  page,
}) => {
  const first = delivery("first", 1, {
    status: "ARRIVED",
    jobVersion: 12,
    allowedActions: ["MARK_DELIVERED"],
  });
  const next = delivery("next", 2);
  await mockRiderBatches(page, [batchValue(first, [next]), batchValue(next)]);
  await page.route("**/api/rider/jobs?v=12", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers()["idempotency-key"]).toMatch(/^delivery-/);
    expect(request.postDataJSON()).toEqual({ orderId: "order-first", action: "MARK_DELIVERED" });
    await route.fulfill({ json: { ok: true, value: { status: "DELIVERED" } } });
  });

  await page.goto("/rider");
  await page.getByRole("button", { name: "Delivered" }).click();

  await expect(page.getByTestId("current-delivery")).toContainText("next Mango Avenue");
  await expect(page.getByTestId("current-delivery")).not.toContainText("first Mango Avenue");
});

test("missing immutable coordinates make navigation explicitly unavailable", async ({ page }) => {
  const current = delivery("missing", 1, {
    destination: {
      coordinate: null,
      displayAddress: "Missing-coordinate address",
      recipient: "Mina",
      phone: "09171234567",
      instructions,
    },
  });
  await mockRiderBatches(page, [batchValue(current)]);

  await page.goto("/rider");

  await expect(page.getByText("Navigation unavailable for this delivery")).toBeVisible();
  await expect(page.getByRole("link", { name: "Navigate" })).toHaveCount(0);
});
