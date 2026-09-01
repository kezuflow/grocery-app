import { describe, expect, it } from "vitest";
import type {
  AdminBootstrapRequest,
  AdminBootstrapView,
  AdminOverviewRequest,
  AdminOverviewView,
} from "./admin-overview";

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

  it("publishes one typed first-render composition with scope evidence", () => {
    const request = {
      requestId: "bootstrap-1",
      headers: {},
      selectedScope: { kind: "GLOBAL" },
      timezone: "Asia/Manila",
    } satisfies AdminBootstrapRequest;
    const bootstrap = {
      context: {
        staffId: "staff-1",
        displayName: "Operator",
        email: "operator@example.com",
        capabilities: [],
        scopes: [{ kind: "global" }],
        navigation: [],
        environment: "test",
      },
      scopes: [],
      selection: {
        selectedScope: request.selectedScope,
        source: "REQUESTED",
        requestedScopeAccepted: true,
        timezone: request.timezone,
      },
      overview: null,
    } satisfies AdminBootstrapView;

    expect(bootstrap.selection).toMatchObject({
      source: "REQUESTED",
      requestedScopeAccepted: true,
    });
  });
});
