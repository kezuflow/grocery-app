// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  players: [] as Array<{
    listeners: Map<string, () => void>;
    goToAndPlay: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("lottie-web/build/player/lottie_light", () => ({
  default: {
    loadAnimation: (config: Record<string, unknown>) => {
      const player = {
        listeners: new Map<string, () => void>(),
        goToAndPlay: vi.fn(),
        destroy: vi.fn(),
        addEventListener(name: string, listener: () => void) {
          this.listeners.set(name, listener);
        },
      };
      runtime.configs.push(config);
      runtime.players.push(player);
      return player;
    },
  },
}));

import { createLocationPinMarkerContent } from "./location-pin-marker";

beforeEach(() => {
  runtime.configs.length = 0;
  runtime.players.length = 0;
});

describe("location pin marker", () => {
  it("loops the supplied animation and can restart it after a drag", async () => {
    const marker = createLocationPinMarkerContent("Delivery entrance", false);
    const animation = marker.element.querySelector<HTMLElement>("[data-location-pin-player]");
    await vi.waitFor(() => expect(runtime.players).toHaveLength(1));
    const player = runtime.players[0];

    expect(runtime.configs[0]).toMatchObject({
      autoplay: true,
      container: animation,
      loop: true,
      renderer: "svg",
    });
    expect(runtime.configs[0]?.animationData).toBeDefined();
    expect(marker.element.dataset.locationPin).toBe("Delivery entrance");
    expect(animation?.style.visibility).toBe("hidden");

    player?.listeners.get("DOMLoaded")?.();
    expect(animation?.style.visibility).toBe("visible");
    expect(marker.element.dataset.locationPinAnimation).toBe("active");
    marker.replay();
    expect(player?.goToAndPlay).toHaveBeenCalledWith(0, true);

    marker.destroy();
    marker.destroy();
    expect(player?.destroy).toHaveBeenCalledOnce();
  });

  it("keeps a static pin for reduced motion and player failures", async () => {
    const reduced = createLocationPinMarkerContent("Reduced pin", true);
    expect(reduced.element.querySelector("svg")).not.toBeNull();
    expect(reduced.element.querySelector("[data-location-pin-player]")).toBeNull();
    expect(reduced.element.dataset.locationPinAnimation).toBe("static");
    expect(runtime.players).toHaveLength(0);

    const failed = createLocationPinMarkerContent("Fallback pin", false);
    const animation = failed.element.querySelector<HTMLElement>("[data-location-pin-player]");
    await vi.waitFor(() => expect(runtime.players).toHaveLength(1));
    runtime.players[0]?.listeners.get("DOMLoaded")?.();
    runtime.players[0]?.listeners.get("error")?.();
    expect(animation?.style.visibility).toBe("hidden");
    expect(failed.element.querySelector("svg")?.style.display).toBe("block");
    expect(failed.element.dataset.locationPinAnimation).toBe("fallback");
    expect(runtime.players[0]?.destroy).toHaveBeenCalledOnce();
  });
});
