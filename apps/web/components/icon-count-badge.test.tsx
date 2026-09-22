// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IconCountBadge } from "./icon-count-badge";

let host: HTMLDivElement;
let root: Root;

function render(count: number) {
  act(() => root.render(<IconCountBadge count={count} />));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retains the previous number only through its exit transition", () => {
  render(0);
  expect(host.querySelector(".fm-count-badge")).toBeNull();

  render(3);
  expect(host.querySelector(".fm-count-badge")?.getAttribute("data-visible")).toBe("true");
  expect(host.textContent).toBe("3");

  render(0);
  expect(host.querySelector(".fm-count-badge")?.getAttribute("data-visible")).toBe("false");
  expect(host.textContent).toBe("3");
  act(() => vi.advanceTimersByTime(200));
  expect(host.querySelector(".fm-count-badge")).toBeNull();
});

it("marks a changed number unsettled for one frame", () => {
  render(2);
  render(4);
  expect(host.textContent).toBe("4");
  expect(host.querySelector(".fm-count-badge-value")?.getAttribute("data-settled")).toBe("false");
  act(() => vi.advanceTimersByTime(16));
  expect(host.querySelector(".fm-count-badge-value")?.getAttribute("data-settled")).toBe("true");
});
