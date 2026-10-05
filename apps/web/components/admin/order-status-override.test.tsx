// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderStates, type AdminOrderDetail } from "@freshmarkets/contracts";
import { OrderStatusOverride } from "./order-status-override";

// Use native controls to exercise command orchestration independently of Radix portals.
vi.mock("./shadcn/select", () => ({
  Select: ({
    children,
    disabled,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    disabled: boolean;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectGroup: ({ children }: { children: ReactNode }) => (
    <optgroup label="Statuses">{children}</optgroup>
  ),
  SelectItem: ({
    children,
    value,
    disabled,
  }: {
    children: ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <option value={value} disabled={disabled}>
      {children}
    </option>
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
const order: Pick<
  AdminOrderDetail,
  "orderId" | "orderNumber" | "status" | "version" | "allowedActions"
> = {
  orderId: "order-1",
  orderNumber: "FM-1001",
  status: "DELIVERED",
  version: 3,
  allowedActions: ["OVERRIDE_STATUS"],
};
let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const changed = vi.fn<() => Promise<void>>();
const interaction = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  changed.mockReset().mockResolvedValue(undefined);
  interaction.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json({
      ok: true,
      requestId: "test",
      value: {
        orderId: order.orderId,
        previousStatus: order.status,
        status: "COMMITTED",
        version: 4,
      },
    }),
  );
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
      <OrderStatusOverride
        order={value}
        disabled={disabled}
        onChanged={changed}
        onInteractionState={interaction}
      />,
    ),
  );
}
function select() {
  return host.querySelector("select") as unknown as HTMLSelectElement;
}
function button(text: string) {
  const value = Array.from(host.querySelectorAll("button")).find(
    (node) => node.textContent === text,
  );
  if (!value) throw new Error(`Missing ${text}`);
  return value as unknown as HTMLButtonElement;
}
async function choose(status = "COMMITTED") {
  await act(async () => {
    select().value = status;
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function reason(value = "  Correct recorded progress  ") {
  await act(async () => {
    const textarea = host.querySelector("textarea") as unknown as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function confirm() {
  await act(async () => button("Confirm status override").click());
}
function reject(code: string) {
  return Response.json({ ok: false, error: { code, message: code, requestId: "test" } });
}

describe("Order status override", () => {
  it("offers every canonical status, including backward corrections, without sending on selection", async () => {
    await render();
    expect(Array.from(select().options, (option) => option.value)).toEqual(orderStates);
    await choose("PENDING_PAYMENT");
    expect(host.textContent).toContain("from Delivered to Pending Payment");
    expect(host.textContent).toContain(
      "payments, refunds, stock and delivery records remain unchanged",
    );
    expect(button("Confirm status override").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(interaction).toHaveBeenLastCalledWith(true, false);
  });
  it("requires a nonblank audit reason and submits only the versioned status correction", async () => {
    await render();
    await choose();
    await reason("   ");
    expect(button("Confirm status override").disabled).toBe(true);
    await reason();
    await confirm();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/orders/order-1/status");
    expect(JSON.parse(init.body)).toEqual({
      status: "COMMITTED",
      reason: "Correct recorded progress",
      expectedVersion: 3,
    });
    expect(init.headers["idempotency-key"]).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Order status changed to Committed");
    expect(interaction).toHaveBeenLastCalledWith(false, false);
  });
  it.each(["network", "CONFLICT", "INTERNAL_ERROR", "invalid-response"])(
    "preserves exact request and key after %s",
    async (outcome) => {
      if (outcome === "network") fetchMock.mockRejectedValueOnce(new Error("Lost response"));
      else if (outcome === "invalid-response")
        fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
      else fetchMock.mockResolvedValueOnce(reject(outcome));
      await render();
      await choose();
      await reason();
      await confirm();
      expect(select().disabled).toBe(true);
      expect(interaction).toHaveBeenLastCalledWith(false, true);
      // Background detail changes must not replace the saved payload/version.
      await render({ ...order, status: "EXCEPTION", version: 10 });
      await act(async () => button("Retry saved status correction").click());
      expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(select().disabled).toBe(false);
    },
  );
  it.each(["STALE_VERSION", "FORBIDDEN"])(
    "refreshes and releases the draft after definitive %s",
    async (code) => {
      fetchMock.mockResolvedValueOnce(reject(code));
      await render();
      await choose();
      await reason();
      await confirm();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain(code);
      expect(host.textContent).not.toContain("Retry saved status correction");
      expect(select().disabled).toBe(false);
      expect(interaction).toHaveBeenLastCalledWith(false, false);
    },
  );
  it("hides the control without Core authority and disables it during other operations", async () => {
    await render({ ...order, allowedActions: [] });
    expect(host.querySelector("select")).toBeNull();
    await render(order, true);
    expect(select().disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retains a retry when authority disappears after an unknown outcome", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Lost response"));
    await render();
    await choose();
    await reason();
    await confirm();
    await render({ ...order, allowedActions: [] });
    fetchMock.mockResolvedValueOnce(reject("FORBIDDEN"));
    await act(async () => button("Retry saved status correction").click());
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(host.querySelector("select")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
