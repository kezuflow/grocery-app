// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../storefront/storefront-runtime", () => ({
  useStorefrontRuntime: () => ({
    googleMapsBrowserApiKey: "browser-key",
    googleMapsMapId: "map-id",
  }),
}));
vi.mock("./google-map", () => ({
  GoogleMap: ({ scene }: { scene: { points: { id: string }[] } }) => (
    <div data-testid="map">{scene.points.map((point) => point.id).join(",")}</div>
  ),
}));

import { DeliveryTrackingMap } from "./delivery-tracking-map";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("delivery tracking map", () => {
  it("shows verified rider and destination pins with an update time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          ok: true,
          value: {
            availability: "LIVE",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: "2026-09-29T00:00:00.000Z",
            },
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<DeliveryTrackingMap endpoint="/tracking" />);
    });
    expect(container.textContent).toContain("Rider location is available");
    expect(container.textContent).toContain("destination,rider");
    expect(fetch).toHaveBeenCalledWith("/tracking", expect.objectContaining({ cache: "no-store" }));
    act(() => root.unmount());
  });

  it("does not render a map for a manual delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          ok: true,
          value: {
            availability: "NOT_SUPPORTED",
            destination: null,
            rider: null,
            nextRefreshMilliseconds: null,
          },
        }),
      })),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<DeliveryTrackingMap endpoint="/tracking" />);
    });
    expect(container.textContent).toContain("Live tracking is unavailable");
    expect(container.querySelector('[data-testid="map"]')).toBeNull();
    act(() => root.unmount());
  });
});
