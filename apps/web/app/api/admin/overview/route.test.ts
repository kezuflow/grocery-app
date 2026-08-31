import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminOverview = vi.hoisted(() => vi.fn());
vi.mock("cloudflare:workers", () => ({ env: { CORE: { getAdminOverview } } }));

import { GET } from "./route";

beforeEach(() => getAdminOverview.mockReset());

describe("Admin overview BFF route", () => {
  it("forwards explicit scope and timezone through the Core binding", async () => {
    getAdminOverview.mockResolvedValue({ ok: true, value: {}, requestId: "overview" });
    const response = await GET(
      new Request(
        "https://freshmarkets.ph/api/admin/overview?scopeKind=LOCATION&marketId=market-metro-cebu&locationId=location-cebu-central&timezone=Asia%2FManila",
        { headers: { cookie: "session=abc" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(getAdminOverview.mock.calls[0][0]).toMatchObject({
      selectedScope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      timezone: "Asia/Manila",
      headers: { cookie: "session=abc" },
    });
  });

  it("rejects missing scope or timezone before Core", async () => {
    const response = await GET(new Request("https://freshmarkets.ph/api/admin/overview"));
    expect(response.status).toBe(400);
    expect(getAdminOverview).not.toHaveBeenCalled();
  });
});
