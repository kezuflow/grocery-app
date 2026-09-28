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
  GoogleMap: ({ scene }: { scene: { points: { id: string; kind?: string }[] } }) => (
    <div data-testid="map">
      {scene.points.map((point) => `${point.id}:${point.kind ?? "pin"}`).join(",")}
    </div>
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
              updatedAt: new Date().toISOString(),
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
    expect(container.textContent).toContain("Rider's last reported location");
    expect(container.textContent).toContain("destination:pin,rider:motorcycle");
    expect(fetch).toHaveBeenCalledWith("/tracking", expect.objectContaining({ cache: "no-store" }));
    act(() => root.unmount());
  });

  it("keeps the last motorcycle location when a refresh fails", async () => {
    const firstRead = new Date("2026-09-29T00:00:00.000Z");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "LIVE",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: firstRead.toISOString(),
            },
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })
      .mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<DeliveryTrackingMap endpoint="/tracking" />));

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("Rider's last reported location");
    expect(container.textContent).toContain("destination:pin,rider:motorcycle");
    expect(container.textContent).toContain("Retry tracking");
    act(() => root.unmount());
  });

  it("keeps the last location through provider downtime and clears it for a missing driver", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "LIVE",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: new Date().toISOString(),
            },
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "UNAVAILABLE",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: null,
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "WAITING",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: null,
            nextRefreshMilliseconds: 30_000,
          },
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<DeliveryTrackingMap endpoint="/tracking" />));
    expect(container.textContent).toContain("rider:motorcycle");

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("rider:motorcycle");
    expect(container.textContent).toContain("Rider's last reported location");

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("Waiting for the rider's location");
    expect(container.textContent).not.toContain("rider:motorcycle");
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
