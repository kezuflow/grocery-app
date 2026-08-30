// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DeliveryOrderList } from "./delivery-order-list";

describe("DeliveryOrderList", () => {
  it("moves deliveries with visible keyboard-accessible controls without changing identity", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onReorder = vi.fn();
    act(() => {
      root.render(
        <DeliveryOrderList
          deliveries={[
            { jobId: "job-1", status: "UNASSIGNED", version: 2 },
            { jobId: "job-2", status: "RETRY_SCHEDULED", version: 5 },
          ]}
          onReorder={onReorder}
        />,
      );
    });

    const moveUp = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Move job-2 up",
    );
    act(() => moveUp?.click());

    expect(onReorder).toHaveBeenCalledWith([
      { jobId: "job-2", status: "RETRY_SCHEDULED", version: 5 },
      { jobId: "job-1", status: "UNASSIGNED", version: 2 },
    ]);
    act(() => root.unmount());
  });

  it("reorders through actual drag/drop events and retains focus after the parent rerenders", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const initial = [
      { jobId: "job-1", status: "UNASSIGNED", version: 2 },
      { jobId: "job-2", status: "RETRY_SCHEDULED", version: 5 },
      { jobId: "job-3", status: "UNASSIGNED", version: 7 },
    ];
    function Harness() {
      const [deliveries, setDeliveries] = useState(initial);
      return (
        <DeliveryOrderList deliveries={deliveries} onReorder={(next) => setDeliveries([...next])} />
      );
    }
    act(() => root.render(<Harness />));
    const rows = container.querySelectorAll("li");
    act(() => {
      rows[0]!.dispatchEvent(new Event("dragstart", { bubbles: true }));
      rows[2]!.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      rows[2]!.dispatchEvent(new Event("drop", { bubbles: true }));
    });
    expect(Array.from(container.querySelectorAll("li")).map((row) => row.textContent)).toEqual([
      expect.stringContaining("job-2"),
      expect.stringContaining("job-3"),
      expect.stringContaining("job-1"),
    ]);

    const moveJob3Up = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move job-3 up"]',
    )!;
    act(() => moveJob3Up.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move job-3 down");
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
    act(() => root.unmount());
    container.remove();
  });

  it("restores focus inside the operated list when another responsive copy exists", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const deliveries = [
      { jobId: "job-1", status: "UNASSIGNED", version: 1 },
      { jobId: "job-2", status: "UNASSIGNED", version: 1 },
    ];
    function ResponsiveCopies() {
      const [mobile, setMobile] = useState(deliveries);
      return (
        <>
          <DeliveryOrderList deliveries={deliveries} onReorder={() => undefined} />
          <div data-testid="mobile-copy">
            <DeliveryOrderList deliveries={mobile} onReorder={(next) => setMobile([...next])} />
          </div>
        </>
      );
    }
    act(() => root.render(<ResponsiveCopies />));
    const mobile = container.querySelector<HTMLElement>('[data-testid="mobile-copy"]')!;
    act(() =>
      mobile.querySelector<HTMLButtonElement>('button[aria-label="Move job-2 up"]')!.click(),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mobile.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move job-2 down");
    act(() => root.unmount());
    container.remove();
  });

  it("focuses an enabled Up control after moving a delivery into the final position", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const initial = [
      { jobId: "job-1", status: "UNASSIGNED", version: 1 },
      { jobId: "job-2", status: "UNASSIGNED", version: 1 },
      { jobId: "job-3", status: "UNASSIGNED", version: 1 },
    ];
    function Harness() {
      const [deliveries, setDeliveries] = useState(initial);
      return (
        <DeliveryOrderList deliveries={deliveries} onReorder={(next) => setDeliveries([...next])} />
      );
    }
    act(() => root.render(<Harness />));
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Move job-2 down"]')!.click(),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(Array.from(container.querySelectorAll("li")).map((row) => row.textContent)).toEqual([
      expect.stringContaining("job-1"),
      expect.stringContaining("job-3"),
      expect.stringContaining("job-2"),
    ]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move job-2 up");
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
    act(() => root.unmount());
    container.remove();
  });
});
