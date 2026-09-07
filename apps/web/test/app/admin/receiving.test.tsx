// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import ReceivingPage from "@/app/admin/receiving/page";
vi.mock("@/components/admin/use-admin-location", () => ({
  useAdminLocation: () => ({ locationId: "cebu", label: "Cebu" }),
}));
vi.mock("@/components/admin/workspace-navigation", () => ({ WorkspaceNavigation: () => null }));
vi.mock("@/components/admin/admin-shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ListPageSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  StatusBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
const session = {
  receivingSessionId: "receipt",
  requirementId: "requirement",
  cycleId: "cycle",
  locationId: "cebu",
  expectedBase: 1000,
  acceptedBase: 0,
  rejectedBase: 0,
  status: "NOT_STARTED",
  version: 7,
  productName: "Red onion",
  cycleName: "Saturday Cebu",
  baseUnit: "g",
  allowedActions: ["START"],
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
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
describe("Receiving command recovery", () => {
  it("uses the selected receipt version and retains the exact request after unknown outcome", async () => {
    const writes: RequestInit[] = [];
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        if (writes.length === 1) throw new Error("lost response");
        return response({
          ok: true,
          requestId: "test",
          value: { ...session, status: "IN_PROGRESS", version: 8 },
        });
      }
      return response({
        ok: true,
        requestId: "test",
        value: { items: [session], nextCursor: null },
      });
    });
    await act(async () => root.render(<ReceivingPage />));
    expect(container.textContent).toContain("Red onion");
    expect(container.textContent).toContain("Saturday Cebu");
    const start = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Start receiving",
    );
    if (!start) throw new Error("Start missing");
    await act(async () => start.click());
    expect(container.textContent).toContain("result is unknown");
    expect(start.disabled).toBe(true);
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry saved receipt",
    );
    if (!retry) throw new Error("Recovery missing");
    await act(async () => retry.click());
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toBe(writes[0].body);
    expect(writes[1].headers).toEqual(writes[0].headers);
    expect(JSON.parse(String(writes[0].body))).toEqual({
      locationId: "cebu",
      requirementId: "requirement",
      expectedVersion: 7,
    });
  });
  it("does not invent actions for completed historical receipts", async () => {
    fetchMock.mockImplementation(async () =>
      response({
        ok: true,
        requestId: "test",
        value: {
          items: [
            {
              ...session,
              status: "COMPLETED",
              acceptedBase: 1000,
              legacyAcceptedBase: 1000,
              allowedActions: [],
            },
          ],
          nextCursor: null,
        },
      }),
    );
    await act(async () => root.render(<ReceivingPage />));
    expect(container.textContent).toContain("accepted before cycle allocation tracking");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Start receiving",
      ),
    ).toBe(false);
    expect(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Complete")
        ?.disabled,
    ).toBe(true);
    expect(container.querySelector('input[placeholder="accepted"]')).toBeNull();
  });
});
