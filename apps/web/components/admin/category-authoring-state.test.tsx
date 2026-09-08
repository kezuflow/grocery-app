// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useCategoryOptions } from "./category-authoring-state";
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
const category = (id: string) => ({
  categoryId: id,
  code: id,
  name: id,
  slug: id,
  status: "active",
  sortOrder: 0,
  parentCategoryId: null,
  parentName: null,
  iconAssetKey: null,
  productCount: 0,
  version: 1,
});
const page = (ids: string[], nextCursor: string | null) =>
  new Response(JSON.stringify({ ok: true, value: { items: ids.map(category), nextCursor } }));
function Harness() {
  const state = useCategoryOptions("self");
  return (
    <>
      <p>{state.loading ? "Loading" : "Loaded"}</p>
      <p>{state.error}</p>
      <ul>
        {state.items.map((item) => (
          <li key={item.categoryId}>{item.name}</li>
        ))}
      </ul>
      {state.hasMore || state.error ? (
        <button disabled={state.loading} onClick={() => void state.loadMore()}>
          More
        </button>
      ) : null}
    </>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("loads another bounded parent page without duplicate or self choices", async () => {
  fetchMock.mockResolvedValueOnce(page(["self", "first"], "cursor-1"));
  await act(async () => root.render(<Harness />));
  fetchMock.mockResolvedValueOnce(page(["first", "second"], null));
  await act(async () => {
    container.querySelector("button")?.click();
    container.querySelector("button")?.click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/admin/catalog/categories?limit=100&cursor=cursor-1",
  );
  expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
    "first",
    "second",
  ]);
  expect(container.querySelector("button")).toBeNull();
});
it("makes a failed initial parent read retryable instead of showing an empty success", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Unavailable"));
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("could not be loaded");
  expect(container.textContent).not.toContain("Loading");
  fetchMock.mockResolvedValueOnce(page(["first"], null));
  await act(async () => container.querySelector("button")?.click());
  expect(container.textContent).not.toContain("could not be loaded");
  expect(container.querySelector("li")?.textContent).toBe("first");
});
