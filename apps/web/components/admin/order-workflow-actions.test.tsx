// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminOrderDetail,
  AdminDeliveryOperationView,
  FulfillmentQueueView,
} from "@freshmarkets/contracts";
import { OrderWorkflowActions } from "./order-workflow-actions";

const admin = vi.hoisted(() => ({
  state: {
    phase: "ready",
    selectedScope: { kind: "GLOBAL", locationId: "" },
    context: {
      capabilities: ["fulfillment.read", "fulfillment.manage", "delivery.read", "delivery.manage"],
    },
  },
}));
vi.mock("../../app/admin/admin-context-provider", () => ({ useAdminContext: () => admin }));
// Test command orchestration with an ordinary select; Radix behavior is covered by its existing primitives.
vi.mock("./shadcn/select", () => ({
  Select: ({
    children,
    disabled,
    onValueChange,
  }: {
    children: ReactNode;
    disabled: boolean;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label="Workflow action"
      disabled={disabled}
      value=""
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Choose action</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectGroup: ({ children }: { children: ReactNode }) => (
    <optgroup label="Actions">{children}</optgroup>
  ),
  SelectLabel: () => null,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("./shadcn/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => children,
}));

const order: AdminOrderDetail = {
  orderId: "order-1",
  orderNumber: "FM-1001",
  customerName: "Customer",
  customerEmail: "customer@example.test",
  fulfillmentMode: "INSTANT",
  status: "COMMITTED",
  totalMinor: 10000,
  currency: "PHP",
  paymentStatus: "SUCCEEDED",
  fulfillmentStatus: "NOT_STARTED",
  deliveryStatus: null,
  deliveryDispatchStatus: null,
  deliveryProviderStatus: null,
  committedAt: new Date(0).toISOString(),
  version: 3,
  allowedActions: ["CANCEL"],
  fulfillment: {
    locationId: "site-1",
    version: 5,
    cycleId: null,
    zoneId: null,
    fulfillmentMode: "INSTANT",
    cutoffAt: null,
    deliveryDate: null,
    promisedAt: null,
    sourcingModes: [],
    status: "NOT_STARTED",
    updatedAt: null,
  },
  delivery: {
    version: 7,
    deliveryJobId: "job-1",
    status: "UNASSIGNED",
    riderUserId: null,
    deliveredAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  customer: { name: "Customer", email: "customer@example.test", phone: null, addressLines: [] },
  financial: {
    subtotalMinor: 10000,
    discountMinor: 0,
    deliveryFeeMinor: 0,
    serviceFeeMinor: 0,
    taxMinor: 0,
    totalMinor: 10000,
    currency: "PHP",
    source: "CHECKOUT_QUOTE",
  },
  items: [],
  payments: [],
  amendments: [],
  exceptions: [],
  timeline: [],
  recentAudit: [],
};
const preparation: FulfillmentQueueView = {
  orderId: "order-1",
  locationId: "site-1",
  cycleId: null,
  status: "NOT_STARTED",
  version: 5,
  allowedActions: ["START_PICKING"],
};
const delivery = {
  orderId: "order-1",
  jobId: "job-1",
  locationId: "site-1",
  version: 7,
  manualActions: [],
  manualDelivery: null,
  externalDispatch: null,
} as unknown as AdminDeliveryOperationView;
let prep: FulfillmentQueueView;
let dispatch: AdminDeliveryOperationView;
let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onChanged = vi.fn<() => Promise<void>>();
const onCancel = vi.fn();
const interaction = vi.fn();
let send: (init: RequestInit) => Promise<Response>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.state.selectedScope = { kind: "GLOBAL", locationId: "" };
  admin.state.context.capabilities = [
    "fulfillment.read",
    "fulfillment.manage",
    "delivery.read",
    "delivery.manage",
  ];
  prep = { ...preparation };
  dispatch = { ...delivery };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onChanged.mockReset().mockResolvedValue(undefined);
  onCancel.mockReset();
  interaction.mockReset();
  fetchMock.mockReset();
  send = async () => Response.json({ ok: true, requestId: "test", value: {} });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return send(init);
    if (url.startsWith("/api/admin/fulfillment?"))
      return Response.json({ ok: true, value: { items: [prep] } });
    if (url.startsWith("/api/admin/delivery?"))
      return Response.json({ ok: true, value: { items: [dispatch] } });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(value = order, disabled = false) {
  await act(async () =>
    root.render(
      <OrderWorkflowActions
        order={value}
        disabled={disabled}
        onCancel={onCancel}
        onChanged={onChanged}
        onInteractionState={interaction}
      />,
    ),
  );
}
function select() {
  return host.querySelector("select") as unknown as HTMLSelectElement;
}
async function choose(value: string) {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Orders workflow commands", () => {
  it("uses the exact Order/location read and offers only current Core actions with cancellation", async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/fulfillment?locationId=site-1&orderId=order-1&limit=1&filter=ALL",
      { cache: "no-store" },
    );
    expect([...select().options].map((option) => option.value)).toEqual([
      "",
      "PREPARATION:START_PICKING",
      "CANCEL",
    ]);
    await choose("CANCEL");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(posts()).toHaveLength(0);
  });

  it("confirms preparation, sends its own version, then refreshes eligible actions and detail", async () => {
    await render();
    await choose("PREPARATION:START_PICKING");
    expect(posts()).toHaveLength(0);
    send = async () => {
      prep = { ...prep, version: 6, allowedActions: ["MARK_READY_TO_PACK"] };
      return Response.json({ ok: true, requestId: "test", value: {} });
    };
    await click("Confirm preparation");
    expect(JSON.parse(posts()[0][1].body)).toEqual({
      locationId: "site-1",
      orderId: "order-1",
      action: "START_PICKING",
      expectedVersion: 5,
    });
    expect(onChanged).toHaveBeenCalledOnce();
    expect([...select().options].map((option) => option.value)).toContain(
      "PREPARATION:MARK_READY_TO_PACK",
    );
  });

  it.each(["transport", "processing"])(
    "retains the identical request and key after %s uncertainty",
    async (failure) => {
      await render();
      await choose("PREPARATION:START_PICKING");
      send = async () => {
        if (failure === "transport") throw new Error("Lost response");
        return Response.json({
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Pending",
            requestId: "test",
            details: { outcome: "RECONCILIATION_PENDING" },
          },
        });
      };
      await click("Confirm preparation");
      expect(select().disabled).toBe(true);
      expect(interaction).toHaveBeenLastCalledWith(false, true);
      const calls = fetchMock.mock.calls.length;
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(fetchMock.mock.calls).toHaveLength(calls);
      send = async () => Response.json({ ok: true, requestId: "test", value: {} });
      await click("Retry saved preparation");
      expect(posts()).toHaveLength(2);
      expect(posts()[1][1]).toEqual(posts()[0][1]);
      expect(onChanged).toHaveBeenCalledOnce();
      expect(select().disabled).toBe(false);
    },
  );

  it("refreshes after definitive stale rejection without claiming success", async () => {
    await render();
    await choose("PREPARATION:START_PICKING");
    send = async () => {
      prep = { ...prep, allowedActions: [] };
      return Response.json({
        ok: false,
        error: { code: "STALE_VERSION", message: "Order changed", requestId: "test" },
      });
    };
    await click("Confirm preparation");
    expect(host.textContent).toContain("Order changed");
    expect(host.textContent).not.toContain("completed.");
    expect(host.textContent).not.toContain("Retry saved preparation");
    expect([...select().options].map((option) => option.value)).toEqual(["", "CANCEL"]);
  });

  it("requires Scheduled physical packing confirmation and preserves its Core guard", async () => {
    prep = { ...prep, allowedActions: ["COMPLETE_SCHEDULED_PACKING"] };
    await render();
    await choose("PREPARATION:COMPLETE_SCHEDULED_PACKING");
    expect(host.textContent).toContain("physically packed and checked accurately");
    expect(posts()).toHaveLength(0);
    await click("Confirm preparation");
    expect(JSON.parse(posts()[0][1].body).action).toBe("COMPLETE_SCHEDULED_PACKING");
  });

  it("hides manage actions for readers and requests no operations for mismatched scope", async () => {
    admin.state.context.capabilities = ["fulfillment.read", "delivery.read"];
    dispatch = { ...dispatch, manualActions: ["COMPLETE"] };
    await render();
    expect([...select().options].map((option) => option.value)).toEqual(["", "CANCEL"]);
    admin.state.selectedScope = { kind: "LOCATION", locationId: "other-site" };
    fetchMock.mockClear();
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Select this order’s location scope");
  });

  it("drops revoked actions on focus, with no editable terminal/provider statuses", async () => {
    await render({ ...order, allowedActions: [] });
    prep = { ...prep, allowedActions: [] };
    dispatch = {
      ...dispatch,
      externalDispatch: {
        providerStatus: "PICKED_UP",
      } as AdminDeliveryOperationView["externalDispatch"],
    };
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(select().disabled).toBe(true);
    expect(host.textContent).toContain("Courier delivery status updates from the provider");
    expect([...select().options].map((option) => option.value)).toEqual([""]);
  });

  it("uses the existing manual completion confirmation, cost and dispatch version, retaining replay", async () => {
    prep = { ...prep, allowedActions: [] };
    dispatch = {
      ...dispatch,
      manualActions: ["COMPLETE"],
      manualDelivery: {
        dispatchId: "manual-1",
        personName: "Staff",
        phoneE164: "+639171234567",
        status: "ACTIVE",
        selectionReason: "STAFF_SELECTED_MANUAL",
        note: null,
        handedOverAt: 1,
        returnInspectedAt: null,
        actualCostMinor: null,
        currency: "PHP",
        version: 11,
      },
    };
    await render();
    await choose("MANUAL:COMPLETE");
    await act(async () =>
      changeInput(host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, "25.50"),
    );
    expect(interaction).toHaveBeenLastCalledWith(true, false);
    await click("Review record delivered");
    expect(posts()).toHaveLength(0);
    send = async () => {
      throw new Error("Lost response");
    };
    await click("Confirm");
    expect(posts()[0][0]).toBe("/api/admin/manual-deliveries");
    expect(JSON.parse(posts()[0][1].body)).toEqual({
      locationId: "site-1",
      jobId: "job-1",
      action: "COMPLETE",
      expectedVersion: 11,
      dispatchId: "manual-1",
      actualCostMinor: 2550,
    });
    expect(select().disabled).toBe(true);
    send = async () => Response.json({ ok: true });
    await click("Retry saved request");
    expect(posts()[1][1]).toEqual(posts()[0][1]);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("shows a read failure instead of inventing actions", async () => {
    fetchMock.mockRejectedValue(new Error("Read unavailable"));
    await render({ ...order, allowedActions: [] });
    expect(host.textContent).toContain("Some workflow actions could not be loaded");
    expect(select().disabled).toBe(true);
    expect(posts()).toHaveLength(0);
  });
});
