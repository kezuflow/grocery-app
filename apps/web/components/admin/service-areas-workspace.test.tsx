// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AdminServiceabilityView } from "@freshmarkets/contracts";
import { ServiceAreasWorkspace } from "./service-areas-workspace";
vi.mock("./admin-shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
const points = [
  { latitude: 10.2, longitude: 123.8 },
  { latitude: 10.2, longitude: 124 },
  { latitude: 10.5, longitude: 124 },
];
const value: AdminServiceabilityView = {
  canManage: true,
  nextCursor: null,
  markets: [{ marketId: "market", name: "Cebu" }],
  areas: [
    {
      serviceAreaId: "area",
      marketId: "market",
      code: "central",
      name: "Cebu delivery",
      vertices: points,
      version: 1,
    },
  ],
};
let container: HTMLDivElement, root: Root;
const fetchMock = vi.fn<typeof fetch>();
const response = (value: unknown) =>
  new Response(JSON.stringify({ ok: true, value, requestId: "test" }));
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  if (!found) throw new Error(`Missing ${text}`);
  return found;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
describe("service-area workspace", () => {
  it("shows read-only areas and preview without publication controls", async () => {
    await act(async () =>
      root.render(
        <ServiceAreasWorkspace
          initial={{ ok: true, requestId: "test", value: { ...value, canManage: false } }}
        />,
      ),
    );
    expect(container.textContent).toContain("Cebu delivery");
    expect(container.textContent).not.toContain("Add service area");
    expect(container.textContent).not.toContain("Edit Cebu delivery");
    expect(button("Preview serviceability")).toBeDefined();
  });
  it("retains the exact publication body and key when the response is lost", async () => {
    const writes: RequestInit[] = [];
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        if (writes.length === 1) throw new Error("Lost response");
        return response({ ...value.areas[0], version: 2 });
      }
      return response(value);
    });
    await act(async () =>
      root.render(<ServiceAreasWorkspace initial={{ ok: true, requestId: "test", value }} />),
    );
    await act(async () => button("Edit Cebu delivery").click());
    const reason = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith("Reason"))
      ?.querySelector("input");
    if (!reason) throw new Error("Missing reason");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Missing input setter");
      setter.call(reason, "Review boundary");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.textContent).toContain("publication result is unknown");
    expect(reason.closest("fieldset")?.disabled).toBe(true);
    await act(async () => button("Retry same publication").click());
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toBe(writes[0].body);
    expect(writes[1].headers).toEqual(writes[0].headers);
    expect(container.textContent).toContain("Service area published");
  });
});
