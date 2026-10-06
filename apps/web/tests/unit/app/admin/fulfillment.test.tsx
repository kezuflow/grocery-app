// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FulfillmentPage from "@/app/admin/fulfillment/page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/admin/use-admin-location", () => ({
  useAdminLocation: () => ({ locationId: "cebu", label: "Cebu" }),
}));
vi.mock("@/app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: {
      phase: "ready",
      selectedScope: { kind: "LOCATION", marketId: "market", locationId: "cebu" },
      scopes: [{ kind: "location", locationId: "cebu", timezone: "Asia/Manila" }],
      context: {
        capabilities: ["fulfillment.read", "fulfillment.manage", "orders.read"],
        scopes: [{ kind: "global" }],
      },
    },
  }),
  useAdminScopeGuard: () => undefined,
}));
vi.mock("@/components/admin/admin-shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ListPageSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  StatusBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/admin/admin-command-state", () => ({
  useAdminCommandIntent: () => ({ pending: false, submit: vi.fn() }),
}));
vi.mock("@/app/admin/admin-operational-refresh-provider", () => ({
  useAdminOperationalRefresh: () => ({
    revision: 0,
    refreshing: false,
    stale: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/components/admin/operational-order-detail", () => ({
  OperationalOrderDetail: ({ item }: { item: { orderId: string } }) => (
    <aside data-selected-order={item.orderId}>{item.orderId}</aside>
  ),
  preparationStatus: (status: string) => status,
}));

function item(orderId: string, progress: "NEW" | "PREPARING") {
  return {
    orderId,
    cycleId: null,
    locationId: "cebu",
    status: progress === "NEW" ? "NOT_STARTED" : "PICKING",
    version: 1,
    allowedActions: [],
    operational: {
      orderNumber: orderId,
      committedAt: new Date(0).toISOString(),
      fulfillmentMode: "INSTANT",
      progress,
      recipient: { name: "Customer", phone: "+639171234567" },
      timing: {
        cycleName: null,
        windowName: null,
        startsAt: null,
        endsAt: null,
        pickupAt: null,
        timezone: null,
      },
      deliveryStatus: null,
      blockers: [],
      lines: [],
    },
  };
}

const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
let root: Root;
let container: HTMLDivElement;

async function flushPage() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe("Fulfillment queue filters", () => {
  it("requests each filter from Core and resets pagination and selection", async () => {
    fetchMock.mockImplementation(async (url) => {
      const params = new URL(String(url), "https://app.example").searchParams;
      const filter = params.get("filter");
      const cursor = params.get("cursor");
      const value =
        filter === "PREPARING"
          ? { items: [item("preparing-order", "PREPARING")], nextCursor: null }
          : cursor
            ? { items: [item("new-order-page-2", "NEW")], nextCursor: null }
            : { items: [item("new-order", "NEW")], nextCursor: "all-next" };
      return response({ ok: true, requestId: "test", value });
    });

    await act(async () => root.render(<FulfillmentPage />));
    await flushPage();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("filter=ALL");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=50");
    expect(container.innerHTML).toContain("new-order");

    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Next",
    );
    if (!next) throw new Error("Next missing");
    await act(async () => next.click());
    await flushPage();
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("cursor=all-next");

    const preparing = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (button) => button.textContent === "Preparing",
    );
    if (!preparing) throw new Error("Preparing filter missing");
    await act(async () =>
      preparing.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
    );
    await flushPage();
    const filteredUrl = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(filteredUrl).toContain("filter=PREPARING");
    expect(filteredUrl).not.toContain("cursor=");
    expect(container.querySelector('tr[aria-selected="true"]')?.textContent).toContain(
      "preparing-order",
    );
  });

  it("selects single/multiple Orders independently of the preview and clears selection on page/view changes", async () => {
    fetchMock.mockImplementation(async (url) => {
      const params = new URL(String(url), "https://app.example").searchParams;
      return response({
        ok: true,
        requestId: "test",
        value: params.has("cursor")
          ? { items: [item("third", "NEW")], nextCursor: null }
          : { items: [item("first", "NEW"), item("second", "NEW")], nextCursor: "next" },
      });
    });
    await act(async () => root.render(<FulfillmentPage />));
    await flushPage();
    const checkbox = (label: string) => {
      const control = container.querySelector<HTMLElement>(
        `[role="checkbox"][aria-label="${label}"]`,
      );
      if (!control) throw new Error(`Missing ${label}`);
      return control;
    };
    await act(async () => checkbox("Select order second for printing").click());
    expect(container.querySelector('tr[aria-selected="true"]')?.textContent).toContain("first");
    expect(checkbox("Select all orders on this page").getAttribute("aria-checked")).toBe("mixed");
    expect(container.textContent).toContain("1 selected");
    await act(async () => checkbox("Select all orders on this page").click());
    expect(container.textContent).toContain("2 selected");
    expect(checkbox("Select all orders on this page").getAttribute("aria-checked")).toBe("true");
    await act(async () => checkbox("Select order first for printing").click());
    expect(container.textContent).toContain("1 selected");
    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Next",
    )!;
    await act(async () => next.click());
    await flushPage();
    expect(container.textContent).toContain("0 selected");
    expect(checkbox("Select order third for printing").getAttribute("aria-checked")).toBe("false");
    await act(async () => checkbox("Select all orders on this page").click());
    const preparing = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.textContent === "Preparing",
    )!;
    await act(async () =>
      preparing.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
    );
    await flushPage();
    expect(container.textContent).toContain("0 selected");
  });
});
