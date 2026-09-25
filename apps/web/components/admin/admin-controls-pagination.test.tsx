// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { AdminCursorPagination, useAdminUrlPagination } from "./admin-controls";

function Harness() {
  const pagination = useAdminUrlPagination("/admin/catalog/products");
  return (
    <>
      <p>
        {pagination.pageNumber}:{pagination.cursor ?? "first"}
      </p>
      <button onClick={() => pagination.next("cursor-two")}>Next</button>
      <button onClick={pagination.previous}>Previous</button>
    </>
  );
}

function NumberedHarness() {
  const pagination = useAdminUrlPagination("/admin/catalog/products");
  return (
    <AdminCursorPagination
      pageNumber={pagination.pageNumber}
      nextCursor={pagination.pageNumber < 3 ? `cursor-${pagination.pageNumber + 1}` : null}
      onPrevious={pagination.previous}
      onNext={pagination.next}
      onPage={pagination.goToPage}
    />
  );
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

it("stores cursor history in the URL for pagination and restoration", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/admin/catalog/products?status=active");
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
  expect(host.textContent).toContain("1:first");

  act(() => host.querySelector("button")?.click());
  await act(async () => root?.render(<Harness />));
  expect(window.location.search).toContain("cursor=cursor-two");
  expect(host.textContent).toContain("2:cursor-two");

  act(() => host.querySelectorAll("button")[1]?.click());
  await act(async () => root?.render(<Harness />));
  expect(window.location.search).toBe("?status=active");
  expect(host.textContent).toContain("1:first");
});

it("shows numbered product pages and returns directly to a known page", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/admin/catalog/products?status=active");
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<NumberedHarness />));
  expect(host.querySelectorAll('[aria-label="Page numbers"] button')).toHaveLength(2);
  expect(host.querySelector('[aria-label="Page 1"]')?.getAttribute("aria-current")).toBe("page");

  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Page 2"]')?.click());
  await act(async () => root?.render(<NumberedHarness />));
  expect(window.location.search).toContain("cursor=cursor-2");
  expect(host.querySelectorAll('[aria-label="Page numbers"] button')).toHaveLength(3);

  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Page 3"]')?.click());
  await act(async () => root?.render(<NumberedHarness />));
  expect(host.querySelector('[aria-label="Page 3"]')?.getAttribute("aria-current")).toBe("page");

  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Page 1"]')?.click());
  await act(async () => root?.render(<NumberedHarness />));
  expect(window.location.search).toBe("?status=active");
  expect(host.querySelector('[aria-label="Page 1"]')?.getAttribute("aria-current")).toBe("page");
});
