// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BannerMediaEditor } from "./banner-media-editor";
vi.mock("@/app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: {
      phase: "ready",
      context: { capabilities: ["promotions.manage"], scopes: [{ kind: "global" }] },
    },
  }),
}));
let root: Root;
const fetchMock = vi.fn();
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }),
  );
  fetchMock.mockReset();
  fetchMock.mockImplementation((_url, options) =>
    Promise.resolve(
      options?.method === "POST"
        ? new Response("Payload Too Large", { status: 413 })
        : Response.json({ ok: true, requestId: "test", value: null }),
    ),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it("treats a plain-text 413 as a rejected upload without retrying or locking the input", async () => {
  await act(async () => root.render(<BannerMediaEditor bannerId="banner-a" archived={false} />));
  const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(fileInput, "files", {
    value: [new File(["image"], "banner.png", { type: "image/png" })],
  });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  const description = document.querySelector<HTMLInputElement>("input[required]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      description,
      "Fresh produce",
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Save image",
  )!;
  await act(async () => save.click());
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  expect(document.body.textContent).toContain("The server rejected the image size");
  expect(document.body.textContent).not.toContain("could not be confirmed");
  expect(fileInput.disabled).toBe(false);
});
