// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerPicker } from "./customer-picker";
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const onChange = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  onChange.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(() =>
    root.render(<CustomerPicker label="Grant customer" value={null} onChange={onChange} />),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function search() {
  await act(async () => container.querySelector("button")?.click());
}
it("shows permission and network failures and lets the operator search again", async () => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Global-scope customers.read is required",
          requestId: "test",
        },
      }),
    )
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      Response.json({ ok: true, value: { items: [], nextCursor: null }, requestId: "test" }),
    );
  await search();
  expect(container.textContent).toContain("customers.read is required");
  await search();
  expect(container.textContent).toContain("could not be loaded");
  await search();
  expect(container.textContent).toContain("No active customers found.");
  expect(onChange).not.toHaveBeenCalled();
});
it("offers active named customers and ignores a result after the search text changes", async () => {
  let resolve: (response: Response) => void = () => {
    throw new Error("missing resolver");
  };
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  await search();
  await act(() => {
    const input = container.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!input || !setter) throw new Error("missing input");
    setter.call(input, "new@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    resolve(
      Response.json({
        ok: true,
        value: {
          items: [
            { customerId: "old", email: "old@example.com", phone: null, accessStatus: "active" },
          ],
          nextCursor: null,
        },
        requestId: "test",
      }),
    ),
  );
  expect(container.textContent).not.toContain("old@example.com");
  fetchMock.mockResolvedValueOnce(
    Response.json({
      ok: true,
      value: {
        items: [
          { customerId: "new", email: "new@example.com", phone: null, accessStatus: "active" },
          {
            customerId: "disabled",
            email: "disabled@example.com",
            phone: null,
            accessStatus: "disabled",
          },
        ],
        nextCursor: null,
      },
      requestId: "test",
    }),
  );
  await search();
  expect(container.textContent).not.toContain("disabled@example.com");
  await act(() => {
    const option = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "new@example.com",
    );
    if (!option) throw new Error("missing customer");
    option.click();
  });
  expect(onChange).toHaveBeenCalledWith({ customerId: "new", label: "new@example.com" });
});
