// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductMediaRecoveryPanel } from "./product-media-recovery-panel";

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
const response = (productId: string, label: string) =>
  new Response(
    JSON.stringify({
      ok: true,
      value: {
        productId,
        nextCursor: null,
        items: [
          {
            itemId: productId,
            kind: "UPLOAD",
            status: "UNKNOWN",
            version: 1,
            label,
            createdAt: 1,
            updatedAt: 1,
            attempts: 0,
            availableAt: null,
            errorCode: null,
            allowedActions: ["OBSERVE_UPLOAD"],
          },
        ],
      },
    }),
  );
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
it("ends initial loading after a failed read and allows refresh", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Unavailable"));
  await act(async () => root.render(<ProductMediaRecoveryPanel productId="first" />));
  expect(container.textContent).toContain("could not be loaded");
  expect(container.textContent).not.toContain("Loading recovery");
  fetchMock.mockResolvedValueOnce(response("first", "Recovered image"));
  await act(async () => container.querySelector("button")?.click());
  expect(container.textContent).toContain("Recovered image");
  expect(container.textContent).not.toContain("could not be loaded");
});
it("ignores an older product read after navigating to another product", async () => {
  let finishFirst: (result: Response) => void = () => {
    throw new Error("No pending read");
  };
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishFirst = resolve;
      }),
  );
  await act(async () => root.render(<ProductMediaRecoveryPanel productId="first" />));
  fetchMock.mockResolvedValueOnce(response("second", "Current product image"));
  await act(async () => root.render(<ProductMediaRecoveryPanel productId="second" />));
  await act(async () => finishFirst(response("first", "Old product image")));
  expect(container.textContent).toContain("Current product image");
  expect(container.textContent).not.toContain("Old product image");
});
