// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CancelOrderAction } from "@/components/storefront/orders/cancel-order-action";
const fetchMock = vi.fn<typeof fetch>();
let root: Root, container: HTMLDivElement;
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
function render(version: number) {
  return act(() =>
    root.render(
      <CancelOrderAction
        orderId="order"
        orderVersion={version}
        available
        disabledReason={null}
        cancellation={{
          status: null,
          requiredRefundMinor: 500,
          retainedServiceFeeMinor: 0,
          currency: "PHP",
        }}
      />,
    ),
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(() => button.click());
}
it("preserves the original customer reason, version and key after an invalid response", async () => {
  const writes: RequestInit[] = [];
  fetchMock.mockImplementation(async (_url, options) => {
    if (!options) throw new Error("Missing request");
    writes.push(options);
    return new Response(
      JSON.stringify(
        writes.length === 1
          ? { ok: true }
          : {
              ok: true,
              requestId: "request",
              value: {
                cancellationId: "cancellation",
                status: "REQUESTED",
                requiredRefundMinor: 500,
                retainedServiceFeeMinor: 0,
                currency: "PHP",
                refunds: [
                  {
                    paymentId: "payment",
                    refundId: null,
                    amountMinor: 500,
                    status: "NOT_REQUESTED",
                  },
                ],
              },
            },
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  await render(3);
  await click("Cancel order");
  const reason = container.querySelector("textarea");
  if (!reason) throw new Error("Missing reason");
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      reason,
      "Plans changed",
    );
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Confirm cancellation");
  expect(container.textContent).toContain("result is unknown");
  expect(reason.disabled).toBe(true);
  await render(9);
  await click("Retry saved cancellation");
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(String(writes[1]?.body))).toEqual({
    expectedVersion: 3,
    reason: "Plans changed",
  });
  expect(container.textContent).toContain("Your refund is processing");
  expect(container.textContent).not.toContain("Cancellation completed");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "View order progress",
  ]);
});
