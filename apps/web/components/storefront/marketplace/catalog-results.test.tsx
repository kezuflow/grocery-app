// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClient } from "../../../lib/query/query-client";
import type { CatalogPresentationPage } from "../../../lib/query/catalog";

const state = vi.hoisted(() => ({ epoch: 0, fetchPage: vi.fn() }));
vi.mock("../../query-provider", () => ({ useQueryEpoch: () => state.epoch }));
vi.mock("../../../lib/query/catalog", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("../../../lib/query/catalog")>()),
  fetchCatalogPage: state.fetchPage,
}));
vi.mock("../catalog-components", () => ({
  ProductGrid: () => <p>product grid</p>,
  ProductGridEmpty: ({ query }: { query: string }) => <p>empty {query}</p>,
}));
vi.mock("./quick-view-provider", () => ({
  QuickViewProvider: ({ children }: { children: ReactNode }) => children,
}));

import { CatalogResults } from "./catalog-results";

afterEach(() => {
  document.body.replaceChildren();
  state.epoch = 0;
  vi.clearAllMocks();
});

it("hydrates the matching first page once and clears it when URL selection changes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = createQueryClient();
  const initialPage: CatalogPresentationPage = { items: [], nextCursor: null };
  state.fetchPage.mockImplementation(() => new Promise<CatalogPresentationPage>(() => {}));

  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CatalogResults selection={{ query: "apple", category: "all" }} initialPage={initialPage} />
      </QueryClientProvider>,
    ),
  );
  expect(host.textContent).toContain("empty apple");
  expect(state.fetchPage).not.toHaveBeenCalled();

  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CatalogResults selection={{ query: "banana", category: "all" }} />
      </QueryClientProvider>,
    ),
  );
  expect(host.textContent).toContain("Loading groceries");
  expect(host.textContent).not.toContain("empty apple");
  expect(state.fetchPage).toHaveBeenCalledOnce();

  act(() => root.unmount());
});

it("does not reseed server bootstrap data after a context epoch change", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = createQueryClient();
  state.fetchPage.mockResolvedValue({ items: [], nextCursor: null });

  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CatalogResults
          selection={{ query: "apple", category: "all" }}
          initialPage={{ items: [], nextCursor: null }}
        />
      </QueryClientProvider>,
    ),
  );
  state.epoch = 1;
  // All/home or an identity reset unmounts the result owner. The original DTO
  // must remain ineligible when that owner returns in a later context.
  await act(async () =>
    root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>),
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CatalogResults
          selection={{ query: "apple", category: "all" }}
          initialPage={{ items: [], nextCursor: null }}
        />
      </QueryClientProvider>,
    ),
  );
  expect(state.fetchPage).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
