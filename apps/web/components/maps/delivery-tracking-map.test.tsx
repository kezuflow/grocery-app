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
  GoogleMap: ({
    scene,
    onUnavailable,
  }: {
    scene: {
      points: { id: string; kind?: string }[];
      lineStrings?: {
        id: string;
        tone?: string;
        points: { latitude: number; longitude: number }[];
      }[];
    };
    onUnavailable?: () => void;
  }) => (
    <div data-testid="map">
      {scene.points.map((point) => `${point.id}:${point.kind ?? "pin"}`).join(",")}
      {scene.lineStrings?.map((line) => `${line.id}:${line.tone}:${line.points.length}`).join(",")}
      <button type="button" onClick={onUnavailable}>
        Simulate map failure
      </button>
    </div>
  ),
}));

import { DeliveryTrackingMap } from "./delivery-tracking-map";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("delivery tracking map", () => {
  it("shows verified rider and destination pins without a report time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          ok: true,
          value: {
            availability: "LIVE",
            attemptId: "attempt-1",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: "2026-09-29T00:00:00.000Z",
            },
            roadRoute: [
              { latitude: 10.32, longitude: 123.91 },
              { latitude: 10.315, longitude: 123.905 },
              { latitude: 10.31, longitude: 123.9 },
            ],
            riderContact: { name: "Rider One", phone: "+639171234567" },
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <DeliveryTrackingMap
          endpoint="/tracking"
          renderContact={(contact) => (
            <a href={contact?.phone ? `tel:${contact.phone}` : undefined}>Call rider</a>
          )}
        />,
      );
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Rider's last reported location.",
    );
    expect(container.textContent).toContain("destination:pin,rider:motorcycle");
    expect(container.textContent).toContain("suggested-road-route:storefront:3");
    expect(container.textContent).toContain("Green line shows a suggested road route");
    act(() => (container.querySelector("button") as HTMLButtonElement | null)?.click());
    expect(container.textContent).not.toContain("Green line shows a suggested road route");
    expect(container.querySelector('a[href="tel:+639171234567"]')?.textContent).toBe("Call rider");
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
            attemptId: "attempt-1",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: firstRead.toISOString(),
            },
            roadRoute: [
              { latitude: 10.32, longitude: 123.91 },
              { latitude: 10.31, longitude: 123.9 },
            ],
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
    expect(container.textContent).toContain("Showing the last confirmed delivery view");
    expect(container.textContent).toContain("destination:pin,rider:motorcycle");
    expect(container.textContent).toContain("suggested-road-route:storefront:2");
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
            attemptId: "attempt-1",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: new Date().toISOString(),
            },
            roadRoute: [
              { latitude: 10.32, longitude: 123.91 },
              { latitude: 10.31, longitude: 123.9 },
            ],
            riderContact: { name: "Former rider", phone: "+639171234567" },
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "UNAVAILABLE",
            attemptId: "attempt-1",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: null,
            riderContact: null,
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "WAITING",
            attemptId: "attempt-1",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: null,
            riderContact: null,
            nextRefreshMilliseconds: 30_000,
          },
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <DeliveryTrackingMap
          endpoint="/tracking"
          renderContact={(contact) =>
            contact?.phone ? <a href={`tel:${contact.phone}`}>Call rider</a> : null
          }
        />,
      ),
    );
    expect(container.textContent).toContain("rider:motorcycle");
    expect(container.textContent).toContain("suggested-road-route:storefront:2");
    expect(container.querySelector('a[href="tel:+639171234567"]')).not.toBeNull();

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("rider:motorcycle");
    expect(container.textContent).toContain("Rider's last reported location");
    expect(container.textContent).toContain("suggested-road-route:storefront:2");
    expect(container.querySelector('a[href="tel:+639171234567"]')).toBeNull();

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("Waiting for the rider's location");
    expect(container.textContent).not.toContain("rider:motorcycle");
    expect(container.textContent).not.toContain("suggested-road-route");
    act(() => root.unmount());
  });

  it("does not reuse a previous attempt's rider after a replacement provider read fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "LIVE",
            attemptId: "attempt-1",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: {
              coordinate: { latitude: 10.32, longitude: 123.91 },
              updatedAt: new Date().toISOString(),
            },
            roadRoute: [
              { latitude: 10.32, longitude: 123.91 },
              { latitude: 10.31, longitude: 123.9 },
            ],
            riderContact: { name: "Former rider", phone: "+639171234567" },
            nextRefreshMilliseconds: 30_000,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          value: {
            availability: "UNAVAILABLE",
            attemptId: "attempt-2",
            destination: { latitude: 10.31, longitude: 123.9 },
            rider: null,
            riderContact: null,
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
    expect(container.textContent).toContain("suggested-road-route:storefront:2");

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("Rider location is temporarily unavailable");
    expect(container.textContent).toContain("destination:pin");
    expect(container.textContent).not.toContain("rider:motorcycle");
    expect(container.textContent).not.toContain("suggested-road-route");
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
            attemptId: null,
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
