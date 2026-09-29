// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

it("sounds once after interaction and respects mute and replay", async () => {
  localStorage.clear();
  const start = vi.fn((_when: number) => undefined);
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = vi.fn(async () => undefined);
      createOscillator() {
        return {
          type: "sine",
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: (gain: object) => gain,
          start,
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        };
      }
    },
  );
  vi.resetModules();
  const { playInAppNotificationSound, setNotificationSoundMuted } = await import("./in-app-sound");
  expect(document.visibilityState).toBe("visible");
  await playInAppNotificationSound("message:order:1");
  expect(start).not.toHaveBeenCalled();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await playInAppNotificationSound("message:order:1");
  expect(localStorage.getItem("freshmarkets:notification-sound-last")).toBe("message:order:1");
  await playInAppNotificationSound("message:order:1");
  expect(start).toHaveBeenCalledTimes(1);
  setNotificationSoundMuted(true);
  await playInAppNotificationSound("message:order:2");
  expect(start).toHaveBeenCalledTimes(1);
  setNotificationSoundMuted(false);
  await playInAppNotificationSound("message:order:2");
  expect(start).toHaveBeenCalledTimes(2);
  await playInAppNotificationSound("message:other-order:1");
  expect(start).toHaveBeenCalledTimes(3);
  expect(start.mock.calls[1][0]).toBeGreaterThan(start.mock.calls[0][0]);
  vi.resetModules();
  const secondTab = await import("./in-app-sound");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await secondTab.playInAppNotificationSound("message:order:1");
  expect(start).toHaveBeenCalledTimes(3);
  let previous = Promise.resolve();
  const lock = vi.fn((_name: string, callback: () => Promise<void>) => {
    const current = previous.then(callback);
    previous = current;
    return current;
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: lock } });
  await Promise.all([
    playInAppNotificationSound("message:concurrent:1"),
    secondTab.playInAppNotificationSound("message:concurrent:1"),
  ]);
  expect(lock).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledTimes(4);
  Reflect.deleteProperty(navigator, "locks");
  vi.unstubAllGlobals();
});
