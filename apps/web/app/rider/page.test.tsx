// @vitest-environment jsdom

import type {
  DeliveryInstructions,
  RiderBatchList,
  RiderDeliveryView,
} from "@freshmarkets/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RiderPage from "./page";

const instructions: DeliveryInstructions = {
  buildingUnit: "Unit 4B",
  landmark: "Orange gate",
  gateGuard: "Ask for Mina",
  deliveryNote: "Keep produce upright",
  recipientInstruction: "Call on arrival",
};

function delivery(
  overrides: Partial<RiderDeliveryView> & Pick<RiderDeliveryView, "jobId" | "sequence">,
): RiderDeliveryView {
  const { jobId, sequence, ...rest } = overrides;
  return {
    jobId,
    stopId: `stop-${jobId}`,
    orderId: `order-${jobId}`,
    sequence,
    status: "ASSIGNED",
    destination: {
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
      displayAddress: `${jobId} Mango Avenue, Cebu City, PH`,
      recipient: `Recipient ${jobId}`,
      phone: `0917000${sequence}`,
      instructions,
    },
    jobVersion: 7,
    stopVersion: 4,
    allowedActions: ["MARK_EN_ROUTE"],
    ...rest,
  };
}

function batches(
  currentDelivery: RiderDeliveryView | null,
  upcomingDeliveries: ReadonlyArray<RiderDeliveryView> = [],
): RiderBatchList {
  return {
    batches: [
      {
        batchId: "batch-1",
        locationId: "location-1",
        fulfillmentMode: "INSTANT",
        cycleId: null,
        status: "IN_PROGRESS",
        version: 3,
        currentDelivery,
        upcomingDeliveries,
      },
    ],
  };
}

function rpc(value: RiderBatchList): Response {
  return Response.json({ ok: true, value, requestId: "request-1" });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<RiderPage />);
  });
  return { container, root };
}

describe("RiderPage batch workflow", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders explicit loading, empty, and safe error states", async () => {
    let resolveLoad!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    );
    const loading = await mount();
    expect(loading.container.querySelector('[role="status"]')?.textContent).toContain(
      "Loading assigned batches",
    );
    await act(async () => resolveLoad(rpc({ batches: [] })));
    expect(loading.container.textContent).toContain("No delivery batches are assigned to you");
    act(() => loading.root.unmount());

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network detail")));
    const failed = await mount();
    await flush();
    expect(failed.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Network error loading your deliveries",
    );
    expect(failed.container.textContent).not.toContain("private network detail");
    act(() => failed.root.unmount());
  });

  it("renders immutable current details, ordered upcoming stops, and one safe Google link", async () => {
    const current = delivery({ jobId: "current", sequence: 2 });
    const upcoming = [
      delivery({ jobId: "third", sequence: 3, allowedActions: [] }),
      delivery({ jobId: "fifth", sequence: 5, allowedActions: [] }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpc(batches(current, upcoming))));

    const { container, root } = await mount();
    await flush();

    const currentCard = container.querySelector('[data-testid="current-delivery"]')!;
    expect(currentCard.textContent).toContain("current Mango Avenue, Cebu City, PH");
    expect(currentCard.textContent).toContain("Recipient current");
    expect(currentCard.textContent).toContain("09170002");
    for (const value of Object.values(instructions))
      expect(currentCard.textContent).toContain(value!);

    const upcomingCards = Array.from(
      container.querySelectorAll('[data-testid="upcoming-delivery"]'),
    );
    expect(upcomingCards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Stop 3"),
      expect.stringContaining("Stop 5"),
    ]);
    expect(upcomingCards[0]?.textContent).toContain("third Mango Avenue");
    expect(upcomingCards[1]?.textContent).toContain("fifth Mango Avenue");

    const navigationLinks = container.querySelectorAll<HTMLAnchorElement>(
      'a[href*="google.com/maps"]',
    );
    expect(navigationLinks).toHaveLength(1);
    expect(navigationLinks[0]?.href).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=10.3157%2C123.8854&travelmode=driving&dir_action=navigate",
    );
    expect(navigationLinks[0]?.target).toBe("_blank");
    expect(navigationLinks[0]?.rel).toBe("noopener noreferrer");
    act(() => root.unmount());
  });

  it("shows navigation unavailable when the current immutable coordinate is missing", async () => {
    const current = delivery({
      jobId: "no-coordinate",
      sequence: 1,
      destination: {
        coordinate: null,
        displayAddress: "No-coordinate address",
        recipient: "Mina",
        phone: "09171234567",
        instructions,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpc(batches(current))));

    const { container, root } = await mount();
    await flush();

    expect(container.textContent).toContain("Navigation unavailable for this delivery");
    expect(container.querySelector('a[href*="google.com/maps"]')).toBeNull();
    act(() => root.unmount());
  });

  it("shows navigation unavailable when the current immutable coordinate is invalid", async () => {
    const current = delivery({
      jobId: "invalid-coordinate",
      sequence: 1,
      destination: {
        coordinate: { latitude: 91, longitude: 123.8854 },
        displayAddress: "Invalid-coordinate address",
        recipient: "Mina",
        phone: "09171234567",
        instructions,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpc(batches(current))));

    const { container, root } = await mount();
    await flush();

    expect(container.textContent).toContain("Navigation unavailable for this delivery");
    expect(container.querySelector('a[href*="google.com/maps"]')).toBeNull();
    act(() => root.unmount());
  });

  it.each([
    ["MARK_EN_ROUTE", "En Route"],
    ["MARK_ARRIVED", "Arrived"],
    ["MARK_DELIVERED", "Delivered"],
    ["MARK_FAILED", "Failed"],
  ] as const)("renders only the Core-provided %s lifecycle action", async (action, label) => {
    const current = delivery({ jobId: action, sequence: 1, allowedActions: [action] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpc(batches(current))));

    const { container, root } = await mount();
    await flush();

    const actionButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-rider-action]"),
    );
    expect(actionButtons.map((button) => button.textContent?.trim())).toEqual([label]);
    expect(actionButtons[0]?.dataset.riderAction).toBe(action);
    act(() => root.unmount());
  });

  it.each([
    ["success", { ok: true, value: { status: "DELIVERED" }, requestId: "command" }],
    [
      "stale",
      {
        ok: false,
        error: { code: "STALE_VERSION", message: "Delivery changed", requestId: "command" },
      },
    ],
  ] as const)(
    "refreshes after a definitive %s result and advances to Core's next delivery",
    async (_case, commandResult) => {
      const first = delivery({
        jobId: "first",
        sequence: 1,
        status: "ARRIVED",
        jobVersion: 12,
        allowedActions: ["MARK_DELIVERED"],
      });
      const next = delivery({ jobId: "next", sequence: 2 });
      let resolveCommand!: (response: Response) => void;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rpc(batches(first, [next])))
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveCommand = resolve;
            }),
        )
        .mockResolvedValueOnce(rpc(batches(next)));
      vi.stubGlobal("fetch", fetchMock);
      const { container, root } = await mount();
      await flush();

      const delivered = container.querySelector<HTMLButtonElement>(
        '[data-rider-action="MARK_DELIVERED"]',
      )!;
      act(() => delivered.click());
      expect(delivered.disabled).toBe(true);
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "Updating delivery",
      );

      await act(async () => resolveCommand(Response.json(commandResult)));
      await flush();

      expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/rider/jobs?v=12");
      const command = fetchMock.mock.calls[1]?.[1] as RequestInit;
      expect(command.method).toBe("POST");
      expect(command.body).toBe(
        JSON.stringify({ orderId: "order-first", action: "MARK_DELIVERED" }),
      );
      expect(new Headers(command.headers).get("idempotency-key")).toMatch(/^delivery-/);
      expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/rider/batches");
      expect(container.querySelector('[data-testid="current-delivery"]')?.textContent).toContain(
        "next Mango Avenue",
      );
      expect(
        container.querySelector('[data-testid="current-delivery"]')?.textContent,
      ).not.toContain("first Mango Avenue");
      act(() => root.unmount());
    },
  );

  it("announces a non-definitive action failure without replacing authoritative delivery state", async () => {
    const current = delivery({ jobId: "failed-action", sequence: 1 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpc(batches(current)))
      .mockResolvedValueOnce(
        Response.json({
          ok: false,
          error: { code: "FORBIDDEN", message: "Action is no longer allowed" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await mount();
    await flush();

    act(() =>
      container.querySelector<HTMLButtonElement>('[data-rider-action="MARK_EN_ROUTE"]')!.click(),
    );
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Action is no longer allowed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="current-delivery"]')?.textContent).toContain(
      "failed-action Mango Avenue",
    );
    act(() => root.unmount());
  });
});
