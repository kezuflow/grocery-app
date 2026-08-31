import { describe, expect, it } from "vitest";
import type { AdminOverviewRequest, AdminOverviewView } from "./admin-overview";

describe("Admin overview contracts", () => {
  it("publishes authoritative values, freshness, bounded exceptions, and denied sections", () => {
    const request = {
      requestId: "overview-1",
      headers: {},
      selectedScope: { kind: "LOCATION", marketId: "market-1", locationId: "location-1" },
      timezone: "Asia/Manila",
    } satisfies AdminOverviewRequest;
    const overview = {
      generatedAt: "2026-08-31T00:00:00.000Z",
      selectedScope: request.selectedScope,
      timezone: request.timezone,
      cards: [
        {
          code: "OPEN_ORDERS",
          label: "Open orders",
          value: 4,
          unavailableReason: null,
          href: "/admin/orders",
        },
      ],
      workloadStages: [{ code: "FULFILLMENT_PENDING", label: "Fulfillment pending", count: 2 }],
      exceptions: [],
      recentOperations: [],
      freshness: { computedAt: "2026-08-31T00:00:00.000Z", sourceWatermark: null },
      deniedSections: ["payments"],
    } satisfies AdminOverviewView;
    expect(overview.cards[0]?.value).toBe(4);
    expect(overview.deniedSections).toEqual(["payments"]);
  });
});
