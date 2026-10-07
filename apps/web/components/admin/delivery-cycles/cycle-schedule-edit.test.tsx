// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AdminDeliveryCycleView, DeliveryCycleDraft } from "@freshmarkets/contracts";
import { CycleEditor } from "./cycle-editor";
import { CycleDetailsPanel } from "./cycle-details-panel";
import { CycleTimeline } from "./cycle-timeline";

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
  vi.useRealTimers();
});
function render(node: ReactNode) {
  act(() => root.render(node));
  return { rerender: (next: ReactNode) => act(() => root.render(next)), container: document.body };
}
function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
const screen = {
  getByRole: (_role: string, { name }: { name: string }) => button(name),
  queryByRole: (role: string, options?: { name: string }) =>
    options
      ? ([...document.querySelectorAll("button")].find(
          (item) => item.textContent?.trim() === options.name,
        ) ?? null)
      : document.querySelector(`[role="${role}"]`),
  getByLabelText: (label: string) =>
    document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
};
const fireEvent = { click: (element: HTMLElement) => act(() => element.click()) };
const draft: DeliveryCycleDraft = {
  cycleId: "cycle-1",
  marketId: "market-1",
  name: "Friday delivery",
  expectedVersion: 3,
  orderOpensAt: "2026-10-01T16:00:00Z",
  cutoffAt: "2026-10-08T16:00:00Z",
  procurementAt: "2026-10-08T18:00:00Z",
  preparationAt: "2026-10-09T05:00:00Z",
  pickupAt: "2026-10-09T06:00:00Z",
  windows: [{ name: "Delivery", startsAt: "2026-10-09T07:00:00Z", endsAt: "2026-10-09T14:00:00Z" }],
  participation: [{ zoneId: "zone-1", locationId: "location-1" }],
  reason: "Supplier delayed packing",
};
function editorProps(): ComponentProps<typeof CycleEditor> {
  return {
    draft,
    mode: "reschedule",
    step: 3,
    setStep: vi.fn(),
    reviewed: false,
    setReviewed: vi.fn(),
    markets: [{ marketId: "market-1", name: "Cebu", timezone: "Asia/Manila" }],
    timezone: "Asia/Manila",
    destinations: {
      items: [
        {
          zoneId: "zone-1",
          zoneName: "Cebu",
          locationId: "location-1",
          locationName: "Central Cebu",
        },
      ],
      nextCursor: null,
    },
    destinationsLoading: false,
    destinationError: null,
    pending: false,
    submitting: false,
    retryAvailable: false,
    onChange: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onRetry: vi.fn(),
    onLoadMoreDestinations: vi.fn(),
  };
}
it("offers schedule editing on a committed active cycle only to a manager", () => {
  const cycle: AdminDeliveryCycleView = {
    ...draft,
    pickupAt: null,
    cycleId: "cycle-1",
    version: 3,
    status: "OPEN",
    marketName: "Cebu",
    timezone: "Asia/Manila",
    windows: [{ ...draft.windows[0]!, windowId: "window-1" }],
    participation: [{ ...draft.participation[0]!, zoneName: "Cebu", locationName: "Central Cebu" }],
    cancellationUnavailableReason:
      "Orders require coordinated operational and financial resolution",
  };
  const onEdit = vi.fn();
  const props = {
    cycle,
    canManage: true,
    pending: false,
    submitting: false,
    retryAvailable: false,
    onClose: vi.fn(),
    onEdit,
    onDuplicate: vi.fn(),
    onCommand: vi.fn(),
    onRetry: vi.fn(),
  };
  const { rerender } = render(<CycleDetailsPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
  expect(onEdit).toHaveBeenCalledOnce();
  rerender(<CycleDetailsPanel {...props} canManage={false} />);
  expect(screen.queryByRole("button", { name: "Edit schedule" })).toBeNull();
});
it("allows an elapsed cutoff during a correction and confirms the complete intent before saving", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T08:00:00Z"));
  try {
    const props = editorProps();
    render(<CycleEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    fireEvent.click(button("Keep editing"));
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    fireEvent.click(button("Apply schedule"));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(draft);
  } finally {
    vi.restoreAllMocks();
  }
});
it("requires an audit reason and keeps all timing controls editable", () => {
  const props = editorProps();
  const { rerender } = render(<CycleEditor {...props} draft={{ ...draft, reason: "" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(props.onSave).not.toHaveBeenCalled();
  rerender(<CycleEditor {...props} step={2} />);
  for (const label of [
    "Orders open",
    "Order cutoff",
    "Procurement starts",
    "Preparation starts",
    "Customer delivery starts",
    "Customer delivery ends",
  ]) {
    expect((screen.getByLabelText(`${label} time`) as HTMLInputElement).disabled).toBe(false);
    expect(
      (screen.getByRole("button", { name: `${label} date` }) as HTMLButtonElement).disabled,
    ).toBe(false);
  }
  expect(document.querySelector('input[aria-label="Planned pickup time"]')).toBeNull();
  act(() => {
    const input = screen.getByLabelText("Order cutoff time");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "01:00");
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(props.onChange).toHaveBeenCalledWith({ ...draft, cutoffAt: "2026-10-08T17:00:00Z" });
});
it("edits the delivery start and end in Step 2 and saves the reviewed range across days", () => {
  const props = editorProps();
  function Harness() {
    const [current, setCurrent] = useState(draft);
    const [step, setStep] = useState(2);
    const [reviewed, setReviewed] = useState(false);
    return (
      <CycleEditor
        {...props}
        draft={current}
        step={step}
        setStep={setStep}
        reviewed={reviewed}
        setReviewed={setReviewed}
        onChange={(next) => {
          props.onChange(next);
          setCurrent(next);
        }}
      />
    );
  }
  render(<Harness />);
  function changeTime(label: string, value: string) {
    act(() => {
      const input = screen.getByLabelText(`${label} time`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  changeTime("Customer delivery starts", "16:00");
  changeTime("Customer delivery ends", "22:00");
  fireEvent.click(button("Customer delivery ends date"));
  const nextDay = [...document.querySelectorAll<HTMLButtonElement>("button[data-day]")].find(
    (button) => button.dataset.day === new Date("2026-10-10T12:00:00").toLocaleDateString(),
  );
  expect(nextDay).toBeDefined();
  fireEvent.click(nextDay!);
  const updated = {
    ...draft,
    windows: [
      { ...draft.windows[0], startsAt: "2026-10-09T08:00:00Z", endsAt: "2026-10-10T14:00:00Z" },
    ],
  };
  expect(props.onChange).toHaveBeenLastCalledWith(updated);
  fireEvent.click(button("Continue"));
  expect(document.body.textContent).toContain("Oct 9, 2026 · 16:00–Oct 10, 2026 · 22:00");
  fireEvent.click(button("Save schedule"));
  expect(props.onSave).not.toHaveBeenCalled();
  fireEvent.click(button("Apply schedule"));
  expect(props.onSave).toHaveBeenCalledExactlyOnceWith(updated);
});
it("keeps Step 2 open when customer delivery starts before preparation or ends before its start", () => {
  const props = editorProps();
  const { rerender } = render(<CycleEditor {...props} step={2} reviewed />);
  for (const windows of [
    [{ ...draft.windows[0], startsAt: "2026-10-09T04:00:00Z" }],
    [{ ...draft.windows[0], endsAt: "2026-10-09T06:00:00Z" }],
  ]) {
    rerender(<CycleEditor {...props} draft={{ ...draft, windows }} step={2} reviewed />);
    fireEvent.click(button("Continue"));
    expect(props.setStep).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  }
});
it("fills the new-cycle editor with a Friday midnight cutoff and Saturday midnight delivery end", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T04:00:00Z"));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const props = editorProps();
  render(
    <CycleEditor
      {...props}
      mode="new"
      step={1}
      draft={{
        ...draft,
        orderOpensAt: "",
        cutoffAt: "",
        procurementAt: "",
        preparationAt: "",
        windows: [],
      }}
    />,
  );
  fireEvent.click(button("Customer delivery date"));
  const friday = [...document.querySelectorAll<HTMLButtonElement>("button[data-day]")].find(
    (button) => button.dataset.day === new Date("2026-10-16T12:00:00").toLocaleDateString(),
  );
  expect(friday).toBeDefined();
  fireEvent.click(friday!);
  expect(props.onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cutoffAt: "2026-10-15T16:00:00Z",
      windows: [
        {
          name: "Scheduled delivery",
          startsAt: "2026-10-16T01:00:00Z",
          endsAt: "2026-10-16T16:00:00Z",
        },
      ],
    }),
  );
});
it("shows the last ordering minute on Thursday and the exclusive cutoff on Friday in business time", () => {
  const { container } = render(
    <CycleTimeline
      timezone="Asia/Manila"
      items={[{ kind: "cutoff", label: "Order cutoff", value: draft.cutoffAt }]}
    />,
  );
  expect(container.textContent).toMatch(/Thu,? (?:8 Oct|Oct 8),? 11:59\s*PM/i);
  expect(container.textContent).toMatch(/Cutoff: Fri,? (?:9 Oct|Oct 9),? 12:00\s*AM/i);
});
