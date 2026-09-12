// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeMapAdapter } from "./fake-map-adapter";
import { GoogleMap } from "./google-map";
import type { MapAdapter, MapAdapterInitialization, MapController } from "./map-types";

const center = { longitude: 123.8854, latitude: 10.3157 };

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
});

function mountMap(properties: Partial<React.ComponentProps<typeof GoogleMap>> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <GoogleMap
        browserApiKey="browser-key"
        mapId="freshmarkets-map"
        initialView={{ center, zoom: 13 }}
        scene={{}}
        {...properties}
      />,
    );
  });
  return { container, root };
}

async function flushEffects(): Promise<void> {
  await act(async () => Promise.resolve());
}

class DeferredMapAdapter implements MapAdapter {
  readonly initializations: MapAdapterInitialization[] = [];
  private resolveInitialization?: (controller: MapController) => void;

  initialize(options: MapAdapterInitialization): Promise<MapController> {
    this.initializations.push(options);
    return new Promise((resolve) => {
      this.resolveInitialization = resolve;
    });
  }

  resolve(controller: MapController): void {
    this.resolveInitialization?.(controller);
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("GoogleMap", () => {
  it("passes browser-safe configuration and scene data to the adapter", async () => {
    const adapter = new FakeMapAdapter();
    const scene = { draggablePin: { position: center, label: "Delivery entrance" } };
    const { root } = mountMap({ adapter, scene });
    await flushEffects();

    expect(adapter.initializations[0]).toMatchObject({
      browserApiKey: "browser-key",
      mapId: "freshmarkets-map",
      initialView: { center, zoom: 13 },
      scene,
    });
    act(() => root.unmount());
    expect(adapter.controllers[0]?.destroyed).toBe(true);
  });

  it("fails closed without either required browser map setting", async () => {
    const adapter = new FakeMapAdapter();
    const { container, root } = mountMap({ browserApiKey: "", adapter });
    await flushEffects();
    expect(container.textContent).toContain("Google Maps configuration is unavailable.");
    expect(adapter.initializations).toHaveLength(0);
    act(() => root.unmount());
  });

  it("forwards map interactions without reinitializing the provider", async () => {
    const adapter = new FakeMapAdapter();
    const onPinMove = vi.fn();
    const onMapClick = vi.fn();
    const onPointActivate = vi.fn();
    const { root } = mountMap({ adapter, onPinMove, onMapClick, onPointActivate });
    await flushEffects();
    adapter.emitPinMove({ latitude: 10.32, longitude: 123.9 });
    adapter.emitMapClick({ latitude: 10.33, longitude: 123.91 });
    adapter.emitPointActivate("point-1");
    expect(onPinMove).toHaveBeenCalledWith({ latitude: 10.32, longitude: 123.9 });
    expect(onMapClick).toHaveBeenCalledWith({ latitude: 10.33, longitude: 123.91 });
    expect(onPointActivate).toHaveBeenCalledWith("point-1");
    expect(adapter.initializations).toHaveLength(1);
    act(() => root.unmount());
  });

  it("keeps the allocated map dimensions when loading fails", async () => {
    const adapter = new FakeMapAdapter({ initializationError: new Error("provider failed") });
    const { container, root } = mountMap({ adapter, className: "h-[420px] w-full" });
    await flushEffects();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain("h-[420px]");
    expect(alert?.textContent).toContain("Google Maps could not be loaded.");
    act(() => root.unmount());
  });

  it("honors reduced motion and forwards area-selection interactions", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const adapter = new FakeMapAdapter();
    const onAreaSelect = vi.fn();
    const onAreaSelectionCancel = vi.fn();
    const { root } = mountMap({ adapter, onAreaSelect, onAreaSelectionCancel });
    await flushEffects();
    expect(adapter.initializations[0]?.reducedMotion).toBe(true);
    adapter.emitAreaSelect(center, { latitude: 10.4, longitude: 123.95 });
    adapter.emitAreaSelectionCancel();
    expect(onAreaSelect).toHaveBeenCalledWith(center, {
      latitude: 10.4,
      longitude: 123.95,
    });
    expect(onAreaSelectionCancel).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("synchronizes the latest scene after deferred initialization", async () => {
    const adapter = new DeferredMapAdapter();
    const controller = {
      updateScene: vi.fn(),
      destroy: vi.fn(),
    } satisfies MapController;
    const firstScene = { points: [{ id: "first", position: center }] };
    const nextScene = { points: [{ id: "next", position: center }], clusterPoints: true };
    const { root } = mountMap({ adapter, scene: firstScene });
    await flushEffects();
    act(() => {
      root.render(
        <GoogleMap
          browserApiKey="browser-key"
          mapId="freshmarkets-map"
          initialView={{ center, zoom: 13 }}
          scene={nextScene}
          adapter={adapter}
        />,
      );
    });
    await act(async () => adapter.resolve(controller));
    expect(controller.updateScene).toHaveBeenCalledWith(nextScene);
    act(() => root.unmount());
    expect(controller.destroy).toHaveBeenCalledOnce();
  });

  it("uses the same safe fallback when the provider reports a delayed load error", async () => {
    const adapter = new FakeMapAdapter();
    const { container, root } = mountMap({ adapter, fallback: <span>Map unavailable</span> });
    await flushEffects();
    act(() => adapter.emitLoadError());
    expect(container.textContent).toContain("Google Maps could not be loaded.");
    expect(container.textContent).toContain("Map unavailable");
    expect(adapter.controllers[0]?.destroyed).toBe(true);
    act(() => root.unmount());
  });

  it("updates scene data without rebuilding a loaded map", async () => {
    const adapter = new FakeMapAdapter();
    const { root } = mountMap({ adapter, scene: {} });
    await flushEffects();
    const scene = {
      points: [{ id: "store", position: center, label: "Central Cebu" }],
      selectedPointIds: ["store"],
      clusterPoints: true,
      lineStrings: [{ id: "route", points: [center, { latitude: 10.32, longitude: 123.9 }] }],
    };
    act(() => {
      root.render(
        <GoogleMap
          browserApiKey="browser-key"
          mapId="freshmarkets-map"
          initialView={{ center, zoom: 13 }}
          scene={scene}
          adapter={adapter}
        />,
      );
    });
    expect(adapter.initializations).toHaveLength(1);
    expect(adapter.controllers[0]?.sceneUpdates).toContainEqual(scene);
    act(() => root.unmount());
  });
});
