import { expect, test } from "@playwright/test";

test("renders the looping location-pin asset inside the draggable Google marker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let mapContainer: HTMLElement | undefined;

    class MapStub {
      constructor(container: HTMLElement) {
        mapContainer = container;
      }

      addListener() {
        return {};
      }

      panTo() {}

      setOptions() {}
    }

    class AdvancedMarkerElementStub {
      position: unknown;
      title: string;
      map: unknown;

      constructor(options: { content?: Node; map?: unknown; position?: unknown; title?: string }) {
        this.position = options.position;
        this.title = options.title ?? "";
        this.map = options.map;
        if (options.content && mapContainer) mapContainer.appendChild(options.content);
      }

      addEventListener() {}
    }

    Object.assign(window, {
      google: {
        maps: {
          event: { removeListener() {} },
          importLibrary: async (name: string) =>
            name === "maps"
              ? { Map: MapStub }
              : { AdvancedMarkerElement: AdvancedMarkerElementStub },
          LatLng: class {},
          RenderingType: { RASTER: "RASTER" },
        },
      },
    });
  });

  const response = await page.goto("/serviceability");

  const map = page.getByRole("region", { name: "Delivery address pin confirmation map" });
  const pin = map.locator('[data-location-pin="Move pin to delivery entrance"]');
  const player = pin.locator("[data-location-pin-player]");
  await expect(pin).toBeVisible();
  await expect(pin).toHaveAttribute("data-location-pin-animation", "active");
  await expect(player).toBeVisible();
  expect((await page.request.get("/animations/location_pin.lottie")).status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).not.toContain("wasm-unsafe-eval");

  const firstFrame = await player.evaluate((element) => element.innerHTML);
  await page.waitForTimeout(300);
  await expect.poll(() => player.evaluate((element) => element.innerHTML)).not.toBe(firstFrame);
});
