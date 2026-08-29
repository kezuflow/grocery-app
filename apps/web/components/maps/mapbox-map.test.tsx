// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeMapAdapter, FakeMapController } from "./fake-map-adapter";
import { MapboxMap } from "./mapbox-map";
import type { MapAdapter, MapAdapterInitialization, MapController, MapScene } from "./map-types";

const provider = vi.hoisted(() => {
  class ProviderSource {
    readonly dataUpdates: unknown[] = [];

    setData(data: unknown): void {
      this.dataUpdates.push(data);
    }
  }

  class ProviderMap {
    readonly sourceOptions: Array<{ id: string; options: Record<string, unknown> }> = [];
    readonly removedSources: string[] = [];
    readonly removedLayers: string[] = [];
    readonly sources = new Map<string, ProviderSource>();

    constructor(_options: unknown) {
      provider.maps.push(this);
    }

    on(event: string, handler: () => void): void {
      if (event === "load") queueMicrotask(handler);
    }

    addSource(id: string, options: Record<string, unknown>): void {
      this.sourceOptions.push({ id, options });
      this.sources.set(id, new ProviderSource());
    }

    getSource(id: string): ProviderSource | undefined {
      return this.sources.get(id);
    }

    removeSource(id: string): void {
      this.removedSources.push(id);
      this.sources.delete(id);
    }

    addLayer(_layer: unknown): void {}

    removeLayer(id: string): void {
      this.removedLayers.push(id);
    }

    remove(): void {}
  }

  class ProviderMarker {
    on(): this {
      return this;
    }
    setLngLat(): this {
      return this;
    }
    addTo(): this {
      return this;
    }
    remove(): void {}
    getLngLat(): { lng: number; lat: number } {
      return { lng: 0, lat: 0 };
    }
    getElement(): { setAttribute: () => void } {
      return { setAttribute: () => undefined };
    }
  }

  return { maps: [] as ProviderMap[], ProviderMap, ProviderMarker };
});

vi.mock("mapbox-gl", () => ({
  default: {
    accessToken: "",
    Map: provider.ProviderMap,
    Marker: provider.ProviderMarker,
  },
  Map: provider.ProviderMap,
  Marker: provider.ProviderMarker,
}));

const center = { longitude: 123.8854, latitude: 10.3157 };

function mountMap(properties: Partial<React.ComponentProps<typeof MapboxMap>> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MapboxMap
        publicAccessToken="public-map-token"
        initialView={{ center, zoom: 13 }}
        scene={{}}
        {...properties}
      />,
    );
  });

  return { container, root };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

class DeferredMapAdapter implements MapAdapter {
  initialization?: MapAdapterInitialization;
  private resolveInitialization?: (controller: MapController) => void;

  initialize(options: MapAdapterInitialization): Promise<MapController> {
    this.initialization = options;
    return new Promise((resolve) => {
      this.resolveInitialization = resolve;
    });
  }

  resolve(controller: MapController): void {
    this.resolveInitialization?.(controller);
  }
}

describe("MapboxMap", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("initializes the adapter only after the map container mounts", async () => {
    const adapter = new FakeMapAdapter();
    const { container, root } = mountMap({ adapter, ariaLabel: "Delivery area map" });

    await flushEffects();

    expect(adapter.initializations).toHaveLength(1);
    expect(adapter.initializations[0]?.container.isConnected).toBe(true);
    expect(adapter.initializations[0]?.publicAccessToken).toBe("public-map-token");
    expect(container.querySelector('[aria-label="Delivery area map"]')).not.toBeNull();

    act(() => root.unmount());
  });

  it("fully destroys the map adapter when unmounted", async () => {
    const adapter = new FakeMapAdapter();
    const { root } = mountMap({ adapter });
    await flushEffects();

    act(() => root.unmount());

    expect(adapter.controllers[0]?.destroyed).toBe(true);
  });

  it("shows an accessible configuration error without initializing when the token is absent", async () => {
    const adapter = new FakeMapAdapter();
    const { container, root } = mountMap({ publicAccessToken: "  ", adapter });
    await flushEffects();

    expect(adapter.initializations).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Map configuration is unavailable",
    );

    act(() => root.unmount());
  });

  it("shows an accessible fallback when map initialization fails", async () => {
    const adapter = new FakeMapAdapter({
      initializationError: new Error("provider details must stay private"),
    });
    const { container, root } = mountMap({ adapter });
    await flushEffects();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The map could not be loaded",
    );
    expect(container.textContent).not.toContain("provider details must stay private");

    act(() => root.unmount());
  });

  it("shows the same safe fallback when the provider reports a map-load error", async () => {
    const adapter = new FakeMapAdapter();
    const { container, root } = mountMap({ adapter });
    await flushEffects();

    act(() => adapter.emitLoadError());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The map could not be loaded",
    );
    expect(adapter.controllers[0]?.destroyed).toBe(true);
    act(() => root.unmount());
  });

  it("forwards draggable-pin movement using provider-neutral coordinates", async () => {
    const adapter = new FakeMapAdapter();
    const onPinMove = vi.fn();
    const { root } = mountMap({ adapter, onPinMove });
    await flushEffects();

    adapter.emitPinMove({ longitude: 123.901, latitude: 10.32 });

    expect(onPinMove).toHaveBeenCalledWith({ longitude: 123.901, latitude: 10.32 });
    act(() => root.unmount());
  });

  it("honors the browser reduced-motion preference during initialization", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const adapter = new FakeMapAdapter();
    const { root } = mountMap({ adapter });
    await flushEffects();

    expect(adapter.initializations[0]?.reducedMotion).toBe(true);
    act(() => root.unmount());
  });

  it("synchronizes the latest scene after deferred initialization resolves", async () => {
    const adapter = new DeferredMapAdapter();
    const initialScene: MapScene = { points: [{ id: "old", position: center }] };
    const latestScene: MapScene = { points: [{ id: "new", position: center }] };
    const { root } = mountMap({ adapter, scene: initialScene });
    await flushEffects();

    act(() => {
      root.render(
        <MapboxMap
          publicAccessToken="public-map-token"
          initialView={{ center, zoom: 13 }}
          scene={latestScene}
          adapter={adapter}
        />,
      );
    });
    const controller = new FakeMapController();
    adapter.resolve(controller);
    await flushEffects();

    expect(controller.sceneUpdates).toEqual([latestScene]);
    act(() => root.unmount());
  });

  it("ignores a delayed error from a replaced adapter without destroying the newer map", async () => {
    const staleAdapter = new FakeMapAdapter();
    const currentAdapter = new FakeMapAdapter();
    const { root } = mountMap({ adapter: staleAdapter });
    await flushEffects();

    act(() => {
      root.render(
        <MapboxMap
          publicAccessToken="public-map-token"
          initialView={{ center, zoom: 13 }}
          scene={{}}
          adapter={currentAdapter}
        />,
      );
    });
    await flushEffects();

    act(() => staleAdapter.emitLoadError());

    expect(currentAdapter.controllers[0]?.destroyed).toBe(false);
    act(() => root.unmount());
  });

  it("reconfigures the provider point source when clustering changes", async () => {
    const unclusteredScene: MapScene = {
      points: [{ id: "delivery-1", position: center }],
      clusterPoints: false,
    };
    const clusteredScene: MapScene = { ...unclusteredScene, clusterPoints: true };
    const { root } = mountMap({ adapter: undefined, scene: unclusteredScene });
    await flushEffects();
    await flushEffects();

    act(() => {
      root.render(
        <MapboxMap
          publicAccessToken="public-map-token"
          initialView={{ center, zoom: 13 }}
          scene={clusteredScene}
        />,
      );
    });

    const map = provider.maps.at(-1);
    expect(
      map?.sourceOptions
        .filter(({ id }) => id === "freshmarkets-points")
        .map(({ options }) => options.cluster),
    ).toEqual([false, true]);
    expect(map?.removedSources).toContain("freshmarkets-points");
    act(() => root.unmount());
  });
});

describe("FakeMapAdapter", () => {
  it("records provider-neutral points, clusters, selection, polygons, and LineStrings", async () => {
    const adapter = new FakeMapAdapter();
    const container = document.createElement("div");
    const onPinMove = vi.fn();
    const scene: MapScene = {
      points: [{ id: "delivery-1", position: center, label: "Delivery 1" }],
      clusterPoints: true,
      selectedPointIds: ["delivery-1"],
      draggablePin: { position: center },
      polygons: [
        {
          id: "service-area",
          rings: [[center, { longitude: 123.9, latitude: 10.31 }, center]],
        },
      ],
      lineStrings: [
        {
          id: "route-preview",
          points: [center, { longitude: 123.9, latitude: 10.31 }],
        },
      ],
    };

    const controller = await adapter.initialize({
      container,
      publicAccessToken: "public-map-token",
      initialView: { center, zoom: 13 },
      scene,
      reducedMotion: false,
      onPinMove,
      onLoadError: vi.fn(),
    });
    const nextScene: MapScene = { ...scene, selectedPointIds: [] };
    controller.updateScene(nextScene);
    adapter.emitPinMove({ longitude: 123.91, latitude: 10.33 });
    controller.destroy();

    expect(adapter.initializations[0]?.scene).toEqual(scene);
    expect(adapter.controllers[0]?.sceneUpdates).toEqual([nextScene]);
    expect(onPinMove).toHaveBeenCalledWith({ longitude: 123.91, latitude: 10.33 });
    expect(adapter.controllers[0]?.destroyed).toBe(true);
  });
});
