// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminPromotionSummary } from "@freshmarkets/contracts";
import { toast } from "sonner";
import { PromotionStatusSwitch } from "./promotion-status-switch";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

type SwitchProps = Pick<AdminPromotionSummary, "promotionId" | "name" | "status" | "version">;

const draftSummary = {
  promotionId: "promo-1",
  code: "SPRING10",
  name: "Spring merch",
  description: "",
  status: "DRAFT",
  benefitType: "ORDER_PERCENT_DISCOUNT",
  discountMinor: null,
  percent: 10,
  maximumDiscountMinor: null,
  minimumMinor: 0,
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: null,
  globalUsageLimit: null,
  perCustomerUsageLimit: null,
  automatic: false,
  priority: 0,
  version: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} as const;

const activeSummary = { ...draftSummary, status: "ACTIVE", version: 4 } as const;

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const onApplied = vi.fn();

function ok(value: unknown): Response {
  return Response.json({ ok: true, requestId: "req-1", value });
}

function fail(): Response {
  return Response.json({
    ok: false,
    error: { code: "STALE_VERSION", message: "The record changed.", requestId: "req-9" },
  });
}

function render(promotion: SwitchProps) {
  act(() => {
    root.render(<PromotionStatusSwitch promotion={promotion} onApplied={onApplied} />);
  });
}

function switchControl(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('button[role="switch"]')!;
}

function clickControl(control: Element): void {
  act(() => {
    control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  onApplied.mockReset();
  vi.mocked(toast.success).mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("renders an on/off switch pill and keeps archived promotions as a plain pill", () => {
  render(draftSummary);
  expect(host.textContent).not.toContain("On");
  expect(host.textContent).not.toContain("Off");
  expect(switchControl()).not.toBeNull();
  expect(switchControl().getAttribute("aria-checked")).toBe("false");

  render({ ...draftSummary, status: "ARCHIVED" });
  expect(host.textContent).toContain("Archived");
  expect(switchControl()).toBeNull();
});

it("sends the Core status command directly, with version and idempotency key, then reports the confirmed status", async () => {
  fetchMock.mockResolvedValue(ok(activeSummary));
  render(draftSummary);
  await act(async () => {
    clickControl(switchControl());
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/admin/promotions/promo-1/status");
  expect(init.headers).toMatchObject({ "content-type": "application/json" });
  expect(String((init.headers as Record<string, string>)["idempotency-key"])).toMatch(/.+/);
  expect(JSON.parse(String(init.body))).toEqual({
    action: "ACTIVATE",
    expectedVersion: 3,
  });
  expect(onApplied).toHaveBeenCalledWith(activeSummary);
  expect(toast.success).toHaveBeenCalledWith("Spring merch turned on", expect.anything());
});

it("replaces the switch with a loading state while the status command is pending", async () => {
  let resolveResponse!: (response: Response) => void;
  fetchMock.mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }),
  );
  render(draftSummary);

  act(() => {
    clickControl(switchControl());
  });

  expect(switchControl()).toBeNull();
  expect(document.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
    "Updating promotion status",
  );

  await act(async () => {
    resolveResponse(ok(activeSummary));
  });
  expect(switchControl()).not.toBeNull();
});

it("keeps the switch unchanged and shows the safe error when Core rejects", async () => {
  fetchMock.mockResolvedValue(fail());
  render({ ...draftSummary, status: "ACTIVE" });
  await act(async () => {
    clickControl(switchControl());
  });

  expect(onApplied).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(switchControl().getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("The record changed.");
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("req-9");
});
