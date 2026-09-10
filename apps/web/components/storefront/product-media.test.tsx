// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductMedia } from "./product-media";
let root: Root;
let visible: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  disconnect.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        visible = () => callback([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it("withholds offscreen image requests until near the viewport", async () => {
  await act(async () =>
    root.render(
      <ProductMedia media={{ src: "/media/products/test/1", alt: "Fruit" }} name="Fruit" />,
    ),
  );
  expect(document.querySelector("img")?.getAttribute("src")).toBeNull();
  await act(async () => visible());
  expect(document.querySelector("img")?.getAttribute("src")).toBe("/media/products/test/1");
  expect(disconnect).toHaveBeenCalled();
});
it("includes priority sources in the first render", async () => {
  await act(async () =>
    root.render(
      <ProductMedia
        priority
        media={{ src: "/media/products/test/1", alt: "Fruit" }}
        name="Fruit"
      />,
    ),
  );
  expect(document.querySelector("img")?.getAttribute("src")).toBe("/media/products/test/1");
  expect(document.querySelector("img")?.getAttribute("loading")).toBe("eager");
});
