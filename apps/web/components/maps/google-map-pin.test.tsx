// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  markerOptions: [] as Array<Record<string, unknown>>,
  markerInstances: [] as Array<{ position: unknown }>,
  markerListeners: new Map<string, () => void>(),
  replay: vi.fn(),
  destroy: vi.fn(),
  createPin: vi.fn(),
}));

vi.mock("./location-pin-marker", () => ({
  createLocationPinMarkerContent: (label: string, reducedMotion: boolean) => {
    runtime.createPin(label, reducedMotion);
    return {
      element: document.createElement("div"),
      replay: runtime.replay,
      destroy: runtime.destroy,
    };
  },
}));

vi.mock("@googlemaps/js-api-loader", () => ({
  setOptions: vi.fn(),
  importLibrary: async (name: string) =>
    name === "maps"
      ? {
          Map: class {
            addListener() {
              return {};
            }
            panTo() {}
            setOptions() {}
          },
        }
      : {
          AdvancedMarkerElement: class {
            position: unknown;
            title: string;
            map: unknown;

            constructor(options: Record<string, unknown>) {
              runtime.markerOptions.push(options);
              this.position = options.position;
              this.title = String(options.title);
              this.map = options.map;
              runtime.markerInstances.push(this);
            }

            addEventListener(name: string, listener: () => void) {
              runtime.markerListeners.set(name, listener);
            }
          },
        },
}));
vi.mock("@googlemaps/markerclusterer", () => ({ MarkerClusterer: class {} }));

import { GoogleMap } from "./google-map";

it("uses the animated content for the draggable pin and cleans it up", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("google", {
    maps: {
      LatLng: class {},
      RenderingType: { RASTER: "RASTER" },
      event: { removeListener: vi.fn() },
    },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onPinMove = vi.fn();

  try {
    await act(async () =>
      root.render(
        <GoogleMap
          browserApiKey="test-key"
          mapId="test-map"
          initialView={{ center: { latitude: 10.3, longitude: 123.9 }, zoom: 15 }}
          scene={{
            draggablePin: {
              label: "Delivery entrance",
              position: { latitude: 10.31, longitude: 123.91 },
            },
          }}
          onPinMove={onPinMove}
        />,
      ),
    );

    expect(runtime.createPin).toHaveBeenCalledWith("Delivery entrance", false);
    expect(runtime.markerOptions[0]).toMatchObject({
      gmpDraggable: true,
      title: "Delivery entrance",
    });
    const marker = runtime.markerInstances[0];
    if (marker) marker.position = { lat: 10.32, lng: 123.92 };
    await act(async () => runtime.markerListeners.get("gmp-dragend")?.());
    expect(runtime.replay).toHaveBeenCalledOnce();
    expect(onPinMove).toHaveBeenCalledWith({ latitude: 10.32, longitude: 123.92 });
  } finally {
    await act(async () => root.unmount());
    expect(runtime.destroy).toHaveBeenCalledOnce();
    host.remove();
    vi.unstubAllGlobals();
  }
});
