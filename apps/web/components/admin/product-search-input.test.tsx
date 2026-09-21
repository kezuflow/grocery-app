// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductSearchInput } from "./product-search-input";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("applies the typed product query only when Enter submits the search", async () => {
  const onSearch = vi.fn();
  await act(async () => root.render(<ProductSearchInput query="" onSearch={onSearch} />));
  const input = container.querySelector<HTMLInputElement>('[type="search"]');
  const form = container.querySelector("form");
  if (!input || !form) throw new Error("Product search form missing");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing input setter");
    setter.call(input, "mango");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(onSearch).not.toHaveBeenCalled();

  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

  expect(onSearch).toHaveBeenCalledOnce();
  expect(onSearch).toHaveBeenCalledWith("mango");
});

it("resets the draft when navigation applies another query", async () => {
  const onSearch = vi.fn();
  await act(async () => root.render(<ProductSearchInput query="mango" onSearch={onSearch} />));
  const input = container.querySelector<HTMLInputElement>('[type="search"]');
  if (!input) throw new Error("Product search input missing");

  await act(async () => root.render(<ProductSearchInput query="banana" onSearch={onSearch} />));

  expect(input.value).toBe("banana");
  expect(onSearch).not.toHaveBeenCalled();
});
