import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMetricDefinitions, getAnalyticsOverview, getMetricSeries } = vi.hoisted(() => ({
  listMetricDefinitions: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getMetricSeries: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    CORE: { listMetricDefinitions, getAnalyticsOverview, getMetricSeries },
  },
}));

import { GET as getDefinitions } from "./definitions/route";
import { GET as getOverview } from "./overview/route";
import { GET as getMetric } from "./metrics/[metric-code]/route";

const COOKIE = { cookie: "session=analytics" };
const WINDOW =
  "startAt=2026-08-01T00%3A00%3A00.000Z&endAt=2026-09-01T00%3A00%3A00.000Z&timezone=Asia%2FManila";
const SCOPE = "scopeKind=LOCATION&marketId=market-metro-cebu&locationId=location-cebu-central";

beforeEach(() => {
  listMetricDefinitions.mockReset();
  getAnalyticsOverview.mockReset();
  getMetricSeries.mockReset();
});

describe("admin analytics BFF routes", () => {
  it("delegates definitions while forwarding cookies and a stable request id", async () => {
    listMetricDefinitions.mockResolvedValue({ ok: true, value: [], requestId: "core-defs" });
    const response = await getDefinitions(
      new Request(
        `https://freshmarkets.ph/api/admin/analytics/definitions?category=ORDERS&status=APPROVED&${SCOPE}`,
        {
          headers: COOKIE,
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: [], requestId: "core-defs" });
    expect(listMetricDefinitions).toHaveBeenCalledTimes(1);
    expect(listMetricDefinitions.mock.calls[0][0]).toMatchObject({
      category: "ORDERS",
      status: "APPROVED",
      scope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      headers: { cookie: "session=analytics" },
    });
    expect(typeof listMetricDefinitions.mock.calls[0][0].requestId).toBe("string");
  });

  it("rejects an invalid definition filter without calling Core", async () => {
    const response = await getDefinitions(
      new Request("https://freshmarkets.ph/api/admin/analytics/definitions?category=NOPE"),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "VALIDATION_FAILED",
    );
    expect(listMetricDefinitions).not.toHaveBeenCalled();
  });

  it("requires and forwards a validated overview window", async () => {
    getAnalyticsOverview.mockResolvedValue({
      ok: true,
      value: { metrics: [], definitions: [] },
      requestId: "core-overview",
    });
    const response = await getOverview(
      new Request(
        `https://freshmarkets.ph/api/admin/analytics/overview?${WINDOW}&${SCOPE}&dimensions=${encodeURIComponent(
          JSON.stringify([
            { key: "currency", value: "PHP" },
            { key: "baseUnit", value: "GRAM" },
          ]),
        )}`,
        { headers: COOKIE },
      ),
    );
    expect(response.status).toBe(200);
    expect(getAnalyticsOverview).toHaveBeenCalledTimes(1);
    expect(getAnalyticsOverview.mock.calls[0][0]).toMatchObject({
      window: {
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      scope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      dimensions: [
        { key: "currency", value: "PHP" },
        { key: "baseUnit", value: "GRAM" },
      ],
      headers: { cookie: "session=analytics" },
    });
  });

  it("rejects missing or malformed overview window before Core", async () => {
    const missing = await getOverview(
      new Request("https://freshmarkets.ph/api/admin/analytics/overview"),
    );
    expect(missing.status).toBe(400);
    const malformed = await getOverview(
      new Request(
        "https://freshmarkets.ph/api/admin/analytics/overview?startAt=bad&endAt=2026-09-01T00:00:00.000Z&timezone=Not/AZone",
      ),
    );
    expect(malformed.status).toBe(400);
    expect(getAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("forwards a metric path code, definition version, window, and cookies", async () => {
    getMetricSeries.mockResolvedValue({
      ok: true,
      value: { metricCode: "order_count", points: [] },
      requestId: "core-series",
    });
    const response = await getMetric(
      new Request(
        `https://freshmarkets.ph/api/admin/analytics/metrics/order_count?${WINDOW}&${SCOPE}&definitionVersion=1`,
        {
          headers: COOKIE,
        },
      ),
      { params: Promise.resolve({ "metric-code": "order_count" }) },
    );
    expect(response.status).toBe(200);
    expect(getMetricSeries).toHaveBeenCalledTimes(1);
    expect(getMetricSeries.mock.calls[0][0]).toMatchObject({
      metricCode: "order_count",
      definitionVersion: 1,
      window: { timezone: "Asia/Manila" },
      scope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      headers: { cookie: "session=analytics" },
    });
  });

  it("rejects an invalid metric code and definition version before Core", async () => {
    const response = await getMetric(
      new Request(
        `https://freshmarkets.ph/api/admin/analytics/metrics/not-valid?${WINDOW}&definitionVersion=0`,
      ),
      { params: Promise.resolve({ "metric-code": "not-valid" }) },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "VALIDATION_FAILED",
    );
    expect(getMetricSeries).not.toHaveBeenCalled();
  });
});
