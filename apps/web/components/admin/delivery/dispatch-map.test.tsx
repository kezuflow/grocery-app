// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeMapAdapter } from "../../maps/fake-map-adapter";
import { DispatchMap } from "./dispatch-map";

const locationMock = vi.hoisted(() => ({
  current: { locationId: "location-1" as string | null, label: "Cebu" },
}));

vi.mock("../admin-shell", async () => {
  const React = await import("react");
  return {
    PageHeader: ({ title }: { title: string }) => React.createElement("h1", null, title),
    FilterBar: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
    ListPageSection: ({ title, children }: { title: string; children: ReactNode }) =>
      React.createElement("section", null, React.createElement("h2", null, title), children),
    StatusBadge: ({ children }: { children: ReactNode }) =>
      React.createElement("span", null, children),
  };
});

vi.mock("../use-admin-location", () => ({
  useAdminLocation: () => locationMock.current,
}));

describe("DispatchMap", () => {
  beforeEach(() => {
    locationMock.current = { locationId: "location-1", label: "Cebu" };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });
  it("loads the exact Instant context and keeps missing-coordinate and ineligible rows usable", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("delivery-batches")) {
        return new Response(
          JSON.stringify({
            ok: true,
            value: [
              {
                riderId: "rider-1",
                displayName: "Rider One",
                openBatchCount: 1,
                openDeliveryCount: 3,
              },
            ],
            requestId: "riders-1",
          }),
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            locationId: "location-1",
            fulfillmentMode: "INSTANT",
            cycleId: null,
            generatedAt: "2026-08-30T00:00:00.000Z",
            pins: [
              {
                jobId: "job-1",
                orderId: "order-1",
                batchId: null,
                coordinate: null,
                fulfillmentMode: "INSTANT",
                cycleId: null,
                status: "ASSIGNED",
                rider: { riderId: "rider-1", displayName: "Rider One" },
                version: 2,
                selection: { selectable: false, reason: "Already assigned" },
              },
            ],
          },
          requestId: "map-1",
        }),
      );
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <DispatchMap
          publicAccessToken={undefined}
          mapAdapter={new FakeMapAdapter()}
          fetchImpl={fetchImpl}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requests).toContain(
      "/api/admin/delivery-map?locationId=location-1&fulfillmentMode=INSTANT",
    );
    expect(container.textContent).toContain("job-1");
    expect(container.textContent).toContain("Already assigned");
    expect(container.textContent).toContain("Map configuration is unavailable");
    expect(container.querySelector<HTMLButtonElement>('button[role="checkbox"]')?.disabled).toBe(
      true,
    );
    act(() => root.unmount());
  });

  it("preserves manual order through warning preview and a two-step atomic idempotent submit", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let resolveBatch!: (response: Response) => void;
    const batchResponse = new Promise<Response>((resolve) => (resolveBatch = resolve));
    const pins = [
      {
        jobId: "job-1",
        orderId: "order-1",
        batchId: null,
        coordinate: { longitude: 123.88, latitude: 10.31 },
        fulfillmentMode: "INSTANT",
        cycleId: null,
        status: "UNASSIGNED",
        rider: null,
        version: 2,
        selection: { selectable: true, reason: null },
      },
      {
        jobId: "job-2",
        orderId: "order-2",
        batchId: null,
        coordinate: { longitude: 123.89, latitude: 10.32 },
        fulfillmentMode: "INSTANT",
        cycleId: null,
        status: "RETRY_SCHEDULED",
        rider: null,
        version: 5,
        selection: { selectable: true, reason: null },
      },
    ];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("route-preview")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              value: {
                outcome: "WARNING",
                geometry: null,
                totalMeters: null,
                totalSeconds: null,
                legs: [],
                warning: { code: "ROUTE_UNAVAILABLE", message: "Order manually" },
              },
              requestId: "preview-1",
            }),
          ),
        );
      }
      if (url === "/api/admin/delivery-batches" && init?.method === "POST") return batchResponse;
      if (url.includes("delivery-batches"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              value: [
                {
                  riderId: "rider-1",
                  displayName: "Rider One",
                  openBatchCount: 1,
                  openDeliveryCount: 3,
                },
              ],
              requestId: "riders-1",
            }),
          ),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            value: {
              locationId: "location-1",
              fulfillmentMode: "INSTANT",
              cycleId: null,
              pins,
              generatedAt: "2026-08-30T00:00:00.000Z",
            },
            requestId: "map-1",
          }),
        ),
      );
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DispatchMap publicAccessToken={undefined} fetchImpl={fetchImpl} />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const checkbox = (jobId: string) =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="Select ${jobId}"]`)!;
    act(() => {
      checkbox("job-1").click();
      checkbox("job-2").click();
    });
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Move job-2 up"]')!.click(),
    );
    const button = (text: string) =>
      Array.from(document.querySelectorAll("button")).find((item) =>
        item.textContent?.includes(text),
      )!;
    await act(async () => {
      button("Preview route").click();
      await Promise.resolve();
    });
    const previewCall = calls.find((call) => call.url.includes("route-preview"))!;
    expect(JSON.parse(String(previewCall.init?.body))).toEqual({
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      orderedDeliveries: [
        { jobId: "job-2", expectedVersion: 5 },
        { jobId: "job-1", expectedVersion: 2 },
      ],
    });
    expect(container.textContent).toContain("Order manually");
    expect(button("Review batch").disabled).toBe(true);

    const riderSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      select.parentElement?.textContent?.includes("Eligible Rider"),
    )!;
    act(() => {
      riderSelect.value = "rider-1";
      riderSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button("Review batch").click());
    expect(document.body.textContent).toContain("Confirm batch assignment");
    expect(
      calls.filter(
        (call) => call.url === "/api/admin/delivery-batches" && call.init?.method === "POST",
      ),
    ).toHaveLength(0);

    act(() => {
      button("Confirm create and assign").click();
      button("Confirm create and assign").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const batchCalls = calls.filter(
      (call) => call.url === "/api/admin/delivery-batches" && call.init?.method === "POST",
    );
    expect(batchCalls).toHaveLength(1);
    const batchCall = batchCalls[0]!;
    expect(JSON.parse(String(batchCall.init?.body))).toEqual({
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      riderId: "rider-1",
      orderedDeliveries: [
        { jobId: "job-2", expectedVersion: 5 },
        { jobId: "job-1", expectedVersion: 2 },
      ],
    });
    const key = new Headers(batchCall.init?.headers).get("idempotency-key");
    expect(key).toBeTruthy();
    expect(String(batchCall.init?.body)).not.toMatch(
      /coordinate|origin|optimi|address|phone|contact/i,
    );

    await act(async () => {
      resolveBatch(
        new Response(
          JSON.stringify({ ok: true, value: { batchId: "batch-1" }, requestId: "batch-request" }),
        ),
      );
      await batchResponse;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Batch batch-1 was created and assigned");
    expect(calls.filter((call) => call.url.startsWith("/api/admin/delivery-map?"))).toHaveLength(2);
    act(() => root.unmount());
    container.remove();
  });

  it("aborts prior context, suppresses stale responses, and sends exact Scheduled filters", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const calls: Array<{ url: string; signal?: AbortSignal | null }> = [];
    let resolveOldMap!: (response: Response) => void;
    let resolveOldRiders!: (response: Response) => void;
    const oldMap = new Promise<Response>((resolve) => (resolveOldMap = resolve));
    const oldRiders = new Promise<Response>((resolve) => (resolveOldRiders = resolve));
    let initial = 0;
    const currentPins = [
      {
        jobId: "scheduled-job",
        orderId: "scheduled-order",
        batchId: null,
        coordinate: null,
        fulfillmentMode: "SCHEDULED",
        cycleId: "cycle-7",
        status: "UNASSIGNED",
        rider: null,
        version: 1,
        selection: { selectable: true, reason: null },
      },
    ];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, signal: init?.signal });
      if (initial++ < 2) return url.includes("delivery-batches") ? oldRiders : oldMap;
      if (url.includes("delivery-batches"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              value: [
                {
                  riderId: "rider-7",
                  displayName: "Rider Seven",
                  openBatchCount: 0,
                  openDeliveryCount: 2,
                },
              ],
              requestId: "riders-new",
            }),
          ),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            value: {
              locationId: "location-1",
              fulfillmentMode: "SCHEDULED",
              cycleId: "cycle-7",
              pins: currentPins,
              generatedAt: "2026-08-30T00:00:00.000Z",
            },
            requestId: "map-new",
          }),
        ),
      );
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<DispatchMap publicAccessToken={undefined} fetchImpl={fetchImpl} />));
    await act(async () => {
      await Promise.resolve();
    });
    const scheduled = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) => input.parentElement?.textContent?.includes("Scheduled"))!;
    act(() => scheduled.click());
    expect(calls[0]?.signal?.aborted).toBe(true);
    const cycle = container.querySelector<HTMLInputElement>("input[required]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        cycle,
        "cycle-7",
      );
      cycle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const status = Array.from(container.querySelectorAll("select")).find((select) =>
      select.parentElement?.textContent?.includes("Status"),
    )!;
    act(() => {
      status.value = "UNASSIGNED";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const rider = Array.from(container.querySelectorAll("select")).find((select) =>
      select.parentElement?.textContent?.includes("Rider filter"),
    )!;
    act(() => {
      rider.value = "rider-7";
      rider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      calls.some(
        ({ url }) =>
          url ===
          "/api/admin/delivery-map?locationId=location-1&fulfillmentMode=SCHEDULED&cycleId=cycle-7&statuses=UNASSIGNED&riderId=rider-7",
      ),
    ).toBe(true);
    resolveOldMap(
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            locationId: "location-1",
            fulfillmentMode: "INSTANT",
            cycleId: null,
            pins: [
              { ...currentPins[0], jobId: "stale-job", fulfillmentMode: "INSTANT", cycleId: null },
            ],
            generatedAt: "old",
          },
          requestId: "old-map",
        }),
      ),
    );
    resolveOldRiders(
      new Response(JSON.stringify({ ok: true, value: [], requestId: "old-riders" })),
    );
    await act(async () => {
      await oldMap;
      await oldRiders;
      await Promise.resolve();
    });
    expect(container.textContent).toContain("scheduled-job");
    expect(container.textContent).not.toContain("stale-job");
    act(() => root.unmount());
  });

  it("caps inclusive area selection at 24 and announces omissions", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const adapter = new FakeMapAdapter();
    const pins = Array.from({ length: 25 }, (_, index) => ({
      jobId: `job-${index + 1}`,
      orderId: `order-${index + 1}`,
      batchId: null,
      coordinate: { longitude: 123.88, latitude: 10.31 },
      fulfillmentMode: "INSTANT" as const,
      cycleId: null,
      status: "UNASSIGNED",
      rider: null,
      version: 1,
      selection: { selectable: true, reason: null },
    }));
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).includes("delivery-batches")
              ? { ok: true, value: [], requestId: "riders" }
              : {
                  ok: true,
                  value: {
                    locationId: "location-1",
                    fulfillmentMode: "INSTANT",
                    cycleId: null,
                    pins,
                    generatedAt: "now",
                  },
                  requestId: "map",
                },
          ),
        ),
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <DispatchMap publicAccessToken="token" mapAdapter={adapter} fetchImpl={fetchImpl} />,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() =>
      adapter.emitAreaSelect(
        { longitude: 123.88, latitude: 10.31 },
        { longitude: 123.88, latitude: 10.31 },
      ),
    );
    expect(container.textContent).toContain("24/24 stops");
    expect(container.textContent).toContain("1 omitted");
    act(() => root.unmount());
  });

  it("loads protected detail only on demand and suppresses it after deselection", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const adapter = new FakeMapAdapter();
    let detailAttempt = 0;
    let resolveOldDetail!: (response: Response) => void;
    const oldDetail = new Promise<Response>((resolve) => (resolveOldDetail = resolve));
    const pin = {
      jobId: "job-detail",
      orderId: "order-detail",
      batchId: null,
      coordinate: { longitude: 123.88, latitude: 10.31 },
      fulfillmentMode: "INSTANT" as const,
      cycleId: null,
      status: "UNASSIGNED",
      rider: null,
      version: 3,
      selection: { selectable: true, reason: null },
    };
    const detailValue = {
      jobId: pin.jobId,
      orderId: pin.orderId,
      orderNumber: "FM-7",
      destination: {
        coordinate: pin.coordinate,
        displayAddress: "Protected address",
        recipient: "Protected recipient",
        phone: "09170000000",
        instructions: {
          buildingUnit: null,
          landmark: "Gate",
          gateGuard: null,
          deliveryNote: null,
          recipientInstruction: null,
        },
      },
      status: "UNASSIGNED",
      version: 3,
      allowedActions: ["CREATE_AND_ASSIGN_BATCH"],
    };
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/detail?")) {
        detailAttempt += 1;
        return detailAttempt === 1
          ? oldDetail
          : Promise.resolve(
              new Response(
                JSON.stringify({ ok: true, value: detailValue, requestId: "detail-new" }),
              ),
            );
      }
      if (url.includes("delivery-batches"))
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, value: [], requestId: "riders" })),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            value: {
              locationId: "location-1",
              fulfillmentMode: "INSTANT",
              cycleId: null,
              pins: [pin],
              generatedAt: "now",
            },
            requestId: "map",
          }),
        ),
      );
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <DispatchMap publicAccessToken="token" mapAdapter={adapter} fetchImpl={fetchImpl} />,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => adapter.emitPointActivate(pin.jobId));
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("expectedVersion=3"))).toBe(
      true,
    );
    act(() => adapter.emitPointActivate(pin.jobId));
    await act(async () => {
      resolveOldDetail(
        new Response(JSON.stringify({ ok: true, value: detailValue, requestId: "detail-old" })),
      );
      await oldDetail;
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Protected address");
    act(() => adapter.emitPointActivate(pin.jobId));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Protected address");
    act(() => root.unmount());
  });

  it("freezes every business input after transport ambiguity and replays the byte-identical payload and key", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const batchKeys: Array<string | null> = [];
    const batchBodies: string[] = [];
    let batchAttempt = 0;
    let mapLoads = 0;
    const pins = [
      {
        jobId: "job-1",
        orderId: "order-1",
        batchId: null,
        coordinate: null,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "UNASSIGNED",
        rider: null,
        version: 4,
        selection: { selectable: true, reason: null },
      },
      {
        jobId: "job-2",
        orderId: "order-2",
        batchId: null,
        coordinate: null,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "RETRY_SCHEDULED",
        rider: null,
        version: 8,
        selection: { selectable: true, reason: null },
      },
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/delivery-batches" && init?.method === "POST") {
        batchKeys.push(new Headers(init.headers).get("idempotency-key"));
        batchBodies.push(String(init.body));
        if (batchAttempt++ === 0) throw new TypeError("connection lost");
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: "STALE_VERSION", message: "Changed", requestId: "stale-1" },
          }),
        );
      }
      if (url.includes("delivery-batches"))
        return new Response(
          JSON.stringify({
            ok: true,
            value: [
              {
                riderId: "rider-1",
                displayName: "Rider One",
                openBatchCount: 0,
                openDeliveryCount: 1,
              },
              {
                riderId: "rider-2",
                displayName: "Rider Two",
                openBatchCount: 1,
                openDeliveryCount: 4,
              },
            ],
            requestId: "riders",
          }),
        );
      mapLoads += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            locationId: "location-1",
            fulfillmentMode: "INSTANT",
            cycleId: null,
            pins,
            generatedAt: "now",
          },
          requestId: "map",
        }),
      );
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DispatchMap publicAccessToken={undefined} fetchImpl={fetchImpl} />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Select job-1"]')!.click(),
    );
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Select job-2"]')!.click(),
    );
    const rider = Array.from(container.querySelectorAll("select")).find((select) =>
      select.parentElement?.textContent?.includes("Eligible Rider"),
    )!;
    act(() => {
      rider.value = "rider-1";
      rider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const findButton = (text: string) =>
      Array.from(document.querySelectorAll("button")).find((item) =>
        item.textContent?.includes(text),
      )!;
    await act(async () => {
      findButton("Review batch").click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton("Confirm create and assign").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("result is unknown");
    expect(container.textContent).toContain("exact assignment");
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')?.disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll("select")).find((select) =>
        select.parentElement?.textContent?.includes("Status"),
      )?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Select job-1"]')?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Move job-2 up"]')?.disabled,
    ).toBe(true);
    expect(rider.disabled).toBe(true);
    act(() => {
      locationMock.current = { locationId: "location-2", label: "Other location" };
      root.render(<DispatchMap publicAccessToken={undefined} fetchImpl={fetchImpl} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mapLoads).toBe(1);
    await act(async () => {
      findButton("Retry exact assignment").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(batchKeys).toHaveLength(2);
    expect(batchKeys[1]).toBe(batchKeys[0]);
    expect(batchBodies[1]).toBe(batchBodies[0]);
    expect(container.textContent).toContain("Authoritative deliveries were refreshed");
    expect(mapLoads).toBe(2);
    expect(container.textContent).toContain("0/24 stops");
    act(() => root.unmount());
    container.remove();
  });

  it("renders explicit scope and request-referenced permission states", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    locationMock.current = { locationId: null, label: "Select a location scope" };
    const noScopeFetch = vi.fn();
    const scopeContainer = document.createElement("div");
    const scopeRoot = createRoot(scopeContainer);
    act(() =>
      scopeRoot.render(<DispatchMap publicAccessToken={undefined} fetchImpl={noScopeFetch} />),
    );
    expect(scopeContainer.textContent).toContain("Select a permitted location");
    expect(noScopeFetch).not.toHaveBeenCalled();
    act(() => scopeRoot.unmount());

    locationMock.current = { locationId: "location-1", label: "Cebu" };
    const forbiddenFetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).includes("delivery-batches")
              ? { ok: true, value: [], requestId: "riders" }
              : {
                  ok: false,
                  error: {
                    code: "FORBIDDEN",
                    message: "No dispatch access",
                    requestId: "forbidden-7",
                  },
                },
          ),
        ),
    );
    const forbiddenContainer = document.createElement("div");
    const forbiddenRoot = createRoot(forbiddenContainer);
    act(() =>
      forbiddenRoot.render(
        <DispatchMap publicAccessToken={undefined} fetchImpl={forbiddenFetch} />,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(forbiddenContainer.textContent).toContain("No dispatch access");
    expect(forbiddenContainer.textContent).toContain("forbidden-7");
    act(() => forbiddenRoot.unmount());
  });

  it("loads detail for assigned and missing-coordinate rows without making them selectable", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const adapter = new FakeMapAdapter();
    const detailJobs: string[] = [];
    const pins = [
      {
        jobId: "job-null",
        orderId: "order-null",
        batchId: "batch-1",
        coordinate: null,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "ASSIGNED",
        rider: { riderId: "rider-old", displayName: "Assigned Rider" },
        version: 3,
        selection: { selectable: false, reason: "Already assigned" },
      },
      {
        jobId: "job-map",
        orderId: "order-map",
        batchId: "batch-1",
        coordinate: { longitude: 123.88, latitude: 10.31 },
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "ASSIGNED",
        rider: { riderId: "rider-old", displayName: "Assigned Rider" },
        version: 4,
        selection: { selectable: false, reason: "Already assigned" },
      },
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/detail?")) {
        const jobId = new URL(url, "https://example.test").searchParams.get("jobId")!;
        detailJobs.push(jobId);
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              jobId,
              orderId: `order-${jobId}`,
              orderNumber: null,
              destination: {
                coordinate: jobId === "job-null" ? null : pins[1]!.coordinate,
                displayAddress: `${jobId} protected address`,
                recipient: "Recipient",
                phone: "09170000000",
                instructions: {
                  buildingUnit: null,
                  landmark: null,
                  gateGuard: null,
                  deliveryNote: null,
                  recipientInstruction: null,
                },
              },
              status: "ASSIGNED",
              version: jobId === "job-null" ? 3 : 4,
              allowedActions: [],
            },
            requestId: `detail-${jobId}`,
          }),
        );
      }
      if (url.includes("delivery-batches"))
        return new Response(JSON.stringify({ ok: true, value: [], requestId: "riders" }));
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            locationId: "location-1",
            fulfillmentMode: "INSTANT",
            cycleId: null,
            pins,
            generatedAt: "now",
          },
          requestId: "map",
        }),
      );
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <DispatchMap publicAccessToken="token" mapAdapter={adapter} fetchImpl={fetchImpl} />,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const nullRow = Array.from(container.querySelectorAll("tr")).find((row) =>
      row.textContent?.includes("job-null"),
    )!;
    const detailButton = Array.from(nullRow.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View detail"),
    )!;
    expect(detailButton.disabled).toBe(false);
    await act(async () => {
      detailButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("job-null protected address");
    await act(async () => {
      adapter.emitPointActivate("job-map");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(detailJobs).toEqual(["job-null", "job-map"]);
    expect(container.textContent).toContain("job-map protected address");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Select job-map"]')?.disabled,
    ).toBe(true);
    act(() => root.unmount());
  });

  it("keeps assigned Rider filter facets separate from eligible assignment Riders and applies exact point tones", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const adapter = new FakeMapAdapter();
    const coordinate = { longitude: 123.88, latitude: 10.31 };
    const pins = [
      {
        jobId: "assigned",
        orderId: "o1",
        batchId: "b1",
        coordinate,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "ASSIGNED",
        rider: { riderId: "rider-old", displayName: "Assigned Only" },
        version: 1,
        selection: { selectable: false, reason: "Assigned" },
      },
      {
        jobId: "retry",
        orderId: "o2",
        batchId: null,
        coordinate,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "RETRY_SCHEDULED",
        rider: null,
        version: 1,
        selection: { selectable: true, reason: null },
      },
      {
        jobId: "blocked",
        orderId: "o3",
        batchId: null,
        coordinate,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "UNASSIGNED",
        rider: null,
        version: 1,
        selection: { selectable: false, reason: "Blocked by Core" },
      },
      {
        jobId: "available",
        orderId: "o4",
        batchId: null,
        coordinate,
        fulfillmentMode: "INSTANT" as const,
        cycleId: null,
        status: "UNASSIGNED",
        rider: null,
        version: 1,
        selection: { selectable: true, reason: null },
      },
    ];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).includes("delivery-batches")
              ? {
                  ok: true,
                  value: [
                    {
                      riderId: "rider-new",
                      displayName: "Eligible Rider",
                      openBatchCount: 0,
                      openDeliveryCount: 0,
                    },
                  ],
                  requestId: "riders",
                }
              : {
                  ok: true,
                  value: {
                    locationId: "location-1",
                    fulfillmentMode: "INSTANT",
                    cycleId: null,
                    pins,
                    generatedAt: "now",
                  },
                  requestId: "map",
                },
          ),
        ),
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <DispatchMap publicAccessToken="token" mapAdapter={adapter} fetchImpl={fetchImpl} />,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const riderFilter = Array.from(container.querySelectorAll("select")).find((select) =>
      select.parentElement?.textContent?.includes("Rider filter"),
    )!;
    const assignmentRider = Array.from(container.querySelectorAll("select")).at(-1)!;
    expect(Array.from(riderFilter.options).map((option) => option.value)).toContain("rider-old");
    expect(Array.from(assignmentRider.options).map((option) => option.value)).not.toContain(
      "rider-old",
    );
    const latestScene =
      adapter.controllers[0]!.sceneUpdates.at(-1) ?? adapter.initializations[0]!.scene;
    expect(latestScene.points?.map(({ id, tone }) => [id, tone])).toEqual([
      ["assigned", "assigned"],
      ["retry", "retry"],
      ["blocked", "blocked"],
      ["available", "available"],
    ]);
    const status = Array.from(container.querySelectorAll("select")).find((select) =>
      select.parentElement?.textContent?.includes("Status"),
    )!;
    act(() => {
      status.value = "ASSIGNED";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(Array.from(riderFilter.options).map((option) => option.value)).toContain("rider-old");
    act(() => root.unmount());
  });

  it.each(["reorder", "deselect", "status", "mode", "cycle", "location"] as const)(
    "suppresses a deferred preview after %s changes its exact fingerprint",
    async (mutation) => {
      (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
      ).IS_REACT_ACT_ENVIRONMENT = true;
      const adapter = new FakeMapAdapter();
      let resolvePreview!: (response: Response) => void;
      const deferredPreview = new Promise<Response>((resolve) => (resolvePreview = resolve));
      const makePins = (fulfillmentMode: "INSTANT" | "SCHEDULED", cycleId: string | null) => [
        {
          jobId: "job-1",
          orderId: "o1",
          batchId: null,
          coordinate: { longitude: 123.88, latitude: 10.31 },
          fulfillmentMode,
          cycleId,
          status: "UNASSIGNED",
          rider: null,
          version: 1,
          selection: { selectable: true, reason: null },
        },
        {
          jobId: "job-2",
          orderId: "o2",
          batchId: null,
          coordinate: { longitude: 123.89, latitude: 10.32 },
          fulfillmentMode,
          cycleId,
          status: "UNASSIGNED",
          rider: null,
          version: 2,
          selection: { selectable: true, reason: null },
        },
      ];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("route-preview")) return deferredPreview;
        if (url.includes("delivery-batches"))
          return new Response(JSON.stringify({ ok: true, value: [], requestId: "riders" }));
        const parsed = new URL(url, "https://example.test");
        const fulfillmentMode = parsed.searchParams.get("fulfillmentMode") as
          | "INSTANT"
          | "SCHEDULED";
        const requestCycle = parsed.searchParams.get("cycleId");
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              locationId: parsed.searchParams.get("locationId"),
              fulfillmentMode,
              cycleId: requestCycle,
              pins: makePins(fulfillmentMode, requestCycle),
              generatedAt: "now",
            },
            requestId: "map",
          }),
        );
      });
      const container = document.createElement("div");
      const root = createRoot(container);
      act(() =>
        root.render(
          <DispatchMap publicAccessToken="token" mapAdapter={adapter} fetchImpl={fetchImpl} />,
        ),
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const setInput = (input: HTMLInputElement, value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      if (mutation === "cycle") {
        const scheduled = Array.from(
          container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
        ).find((input) => input.parentElement?.textContent?.includes("Scheduled"))!;
        act(() => scheduled.click());
        act(() =>
          setInput(container.querySelector<HTMLInputElement>("input[required]")!, "cycle-1"),
        );
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      act(() => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Select job-1"]')!.click();
        container.querySelector<HTMLButtonElement>('button[aria-label="Select job-2"]')!.click();
      });
      act(() =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Preview route"))!
          .click(),
      );
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        if (mutation === "reorder")
          container.querySelector<HTMLButtonElement>('button[aria-label="Move job-2 up"]')!.click();
        if (mutation === "deselect")
          container.querySelector<HTMLButtonElement>('button[aria-label="Select job-1"]')!.click();
        if (mutation === "status") {
          const status = Array.from(container.querySelectorAll("select")).find((select) =>
            select.parentElement?.textContent?.includes("Status"),
          )!;
          status.value = "UNASSIGNED";
          status.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (mutation === "mode") {
          const scheduled = Array.from(
            container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
          ).find((input) => input.parentElement?.textContent?.includes("Scheduled"))!;
          scheduled.click();
        }
        if (mutation === "cycle")
          setInput(container.querySelector<HTMLInputElement>("input[required]")!, "cycle-2");
        if (mutation === "location") {
          locationMock.current = { locationId: "location-2", label: "Other" };
          root.render(
            <DispatchMap publicAccessToken="token" mapAdapter={adapter} fetchImpl={fetchImpl} />,
          );
        }
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        resolvePreview(
          new Response(
            JSON.stringify({
              ok: true,
              value: {
                outcome: "AVAILABLE",
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [123.88, 10.31],
                    [123.89, 10.32],
                  ],
                },
                totalMeters: 10,
                totalSeconds: 20,
                legs: [],
                warning: null,
              },
              requestId: "preview",
            }),
          ),
        );
        await deferredPreview;
        await Promise.resolve();
      });
      expect(container.textContent).not.toContain("Route preview available");
      expect(adapter.controllers[0]!.sceneUpdates.at(-1)?.lineStrings ?? []).toEqual([]);
      act(() => root.unmount());
    },
  );
});
