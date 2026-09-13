// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { useAdminUrlPagination } from "./admin-controls";

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
