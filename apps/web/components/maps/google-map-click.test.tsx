// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GoogleMap } from "./google-map";

const runtime = vi.hoisted(() => ({ click: (_event: unknown) => {} }));
vi.mock("@googlemaps/js-api-loader", () => ({
  setOptions: vi.fn(),
  importLibrary: async (name: string) =>
    name === "maps"
      ? {
          Map: class {
            addListener(_name: string, callback: (event: unknown) => void) {
              runtime.click = callback;
              return {};
            }
          },
        }
      : { AdvancedMarkerElement: class {} },
}));
vi.mock("@googlemaps/markerclusterer", () => ({ MarkerClusterer: class {} }));

it("the Google adapter forwards boundary clicks without a draggable address pin", async () => {
  class LatLng {
    lat() {
      return 10.3;
    }
    lng() {
      return 123.9;
    }
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("google", {
    maps: { LatLng, RenderingType: { RASTER: "RASTER" }, event: { removeListener: vi.fn() } },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onMapClick = vi.fn();
  try {
    await act(async () =>
      root.render(
        <GoogleMap
          browserApiKey="test-key"
          mapId="test-map"
          initialView={{ center: { latitude: 10.3, longitude: 123.9 }, zoom: 11 }}
          scene={{}}
          onMapClick={onMapClick}
        />,
      ),
    );
    await act(async () => runtime.click({ latLng: new LatLng() }));
    expect(onMapClick).toHaveBeenCalledExactlyOnceWith({ latitude: 10.3, longitude: 123.9 });
    await act(async () => runtime.click({ latLng: null }));
    expect(onMapClick).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
