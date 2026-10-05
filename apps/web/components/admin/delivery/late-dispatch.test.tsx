// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { DispatchActions } from "./dispatch-actions";
import { ExternalDeliveryBooking } from "./external-delivery-booking";
import { ManualDeliveryControls } from "./manual-delivery-controls";

let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function button(text: string) {
  const found = [...document.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
function input(selector: string, value: string) {
  const node = document.querySelector<HTMLInputElement>(selector)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const item: AdminDeliveryOperationView = {
  jobId: "job-1",
  orderId: "order-1",
  recipient: { name: null, phone: null },
  cycleId: "cycle-1",
  locationId: "location-1",
  fulfillmentMode: "SCHEDULED",
  status: "UNASSIGNED",
  version: 1,
  manualActions: ["ASSIGN"],
  canRevisePromise: false,
  canInspectReturnedGoods: false,
  courierPickup: {
    allowedKinds: ["IMMEDIATE", "SCHEDULED"],
    unavailableReason: null,
    deadlineAt: new Date(Date.now() - 86400000).toISOString(),
    isLate: true,
  },
  manualDelivery: null,
  externalDispatch: null,
  deliveredAtIso: null,
};

it("shows the late warning and both eligible dispatch methods", () => {
  act(() =>
    root.render(
      <DispatchActions
        item={item}
        onBooked={vi.fn()}
        onChanged={vi.fn()}
        onInteractionState={vi.fn()}
      />,
    ),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Scheduled delivery window passed",
  );
  expect(button("Request Lalamove").disabled).toBe(false);
  expect(button("Assign manual rider").disabled).toBe(false);
});

it("requires and reviews a late courier reason, then retains the exact request after an unknown outcome", async () => {
  const fetchImpl = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        value: { status: "ACTIVE", quoteAmountMinor: null, quoteCurrency: null },
      }),
    );
  const onBooked = vi.fn();
  act(() =>
    root.render(
      <ExternalDeliveryBooking
        locationId={item.locationId}
        fulfillmentMode="SCHEDULED"
        delivery={item}
        readiness={item.courierPickup}
        disabled={false}
        fetchImpl={fetchImpl}
        onBooked={onBooked}
      />,
    ),
  );
  expect(button("Review Lalamove booking").disabled).toBe(true);
  input("#late-reason-job-1", "  Packing ran late  ");
  act(() => button("Review Lalamove booking").click());
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Late delivery reason: Packing ran late",
  );
  await act(async () => button("Confirm and book").click());
  expect(document.querySelector<HTMLInputElement>("#late-reason-job-1")?.disabled).toBe(true);
  await act(async () => button("Retry saved booking request").click());
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[1]).toEqual(fetchImpl.mock.calls[0]);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
    lateDispatchReason: "Packing ran late",
    pickup: { kind: "IMMEDIATE" },
    expectedVersion: 1,
  });
  expect(onBooked).toHaveBeenCalledOnce();
});

it("requires a reason for a future pickup beyond a currently open delivery window", () => {
  const readiness = {
    ...item.courierPickup,
    isLate: false,
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
  };
  act(() =>
    root.render(
      <ExternalDeliveryBooking
        locationId={item.locationId}
        fulfillmentMode="SCHEDULED"
        delivery={item}
        readiness={readiness}
        disabled={false}
        fetchImpl={vi.fn()}
        onBooked={vi.fn()}
      />,
    ),
  );
  expect(document.querySelector("#late-reason-job-1")).toBeNull();
  act(() => document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click());
  const pickup = new Date(Date.now() + 7200000);
  const local = new Date(pickup.getTime() - pickup.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  input('input[type="datetime-local"]', local);
  expect(document.querySelector<HTMLInputElement>("#late-reason-job-1")?.required).toBe(true);
  expect(button("Review Lalamove booking").disabled).toBe(true);
  input("#late-reason-job-1", "Customer requested later collection");
  expect(button("Review Lalamove booking").disabled).toBe(false);
});

it("requires and confirms the manual late reason before submitting the assignment", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  act(() =>
    root.render(
      <ManualDeliveryControls item={item} initialAction="ASSIGN" onChanged={onChanged} />,
    ),
  );
  input('input:not([id]):not([type="tel"])', "Assigned Rider");
  input('input[type="tel"]', "+639171234567");
  act(() =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  input("#manual-note-job-1", "  Packing ran late  ");
  act(() =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Late delivery reason: Packing ran late",
  );
  await act(async () => button("Confirm").click());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    action: "ASSIGN",
    lateDispatchReason: "Packing ran late",
  });
  expect(onChanged).toHaveBeenCalledOnce();
});
