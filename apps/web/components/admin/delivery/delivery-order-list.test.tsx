// @vitest-environment jsdom

import { act } from "react";
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
});
