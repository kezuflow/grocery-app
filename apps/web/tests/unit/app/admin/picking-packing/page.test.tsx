// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  requestedLocationId: "location-1",
  mode: "selected" as "selected" | "other" | "denied",
  selectScope: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => fixture.requestedLocationId }),
}));
vi.mock("@/app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: {
      phase: "ready",
      context: { capabilities: ["fulfillment.read"] },
      scopes:
        fixture.mode === "denied"
          ? []
          : [
              {
                kind: "location",
                marketId: "market-1",
                locationId: "location-1",
                locationName: "Assigned hub",
              },
            ],
      selectedScope:
        fixture.mode === "selected"
          ? { kind: "LOCATION", marketId: "market-1", locationId: "location-1" }
          : { kind: "GLOBAL" },
    },
    selectScope: fixture.selectScope,
  }),
}));
vi.mock("@/app/admin/fulfillment/page", () => ({
  FulfillmentWorkspace: () => <div>Scoped paid-order station</div>,
}));

import PickingPackingPage from "@/app/admin/picking-packing/page";

describe("picking and packing station scope", () => {
  it("opens the station for its explicitly selected location", () => {
    fixture.mode = "selected";
    expect(renderToStaticMarkup(<PickingPackingPage />)).toContain("Scoped paid-order station");
  });

  it("does not read an unassigned location", () => {
    fixture.mode = "denied";
    const html = renderToStaticMarkup(<PickingPackingPage />);
    expect(html).toContain("Picking and packing is unavailable");
    expect(html).not.toContain("Scoped paid-order station");
  });

  it("requests an authorized scope switch before loading another location", async () => {
    fixture.mode = "other";
    fixture.selectScope.mockClear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<PickingPackingPage />));
      expect(host.textContent).not.toContain("Scoped paid-order station");
      await act(async () => host.querySelector("button")!.click());
      expect(fixture.selectScope).toHaveBeenCalledWith({
        kind: "LOCATION",
        marketId: "market-1",
        locationId: "location-1",
      });
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
