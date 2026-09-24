// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BannerMediaEditor } from "./banner-media-editor";
vi.mock("@/app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: {
      phase: "ready",
      selectedScope: { kind: "GLOBAL" },
      context: {
        capabilities: ["promotions.read", "promotions.manage"],
        scopes: [{ kind: "global" }],
      },
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

async function chooseImage() {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", {
    value: [new File(["image"], "banner.png", { type: "image/png" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const description = document.querySelector<HTMLInputElement>(
    'input[placeholder="Describe what appears in the banner"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      description,
      "Fresh produce",
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) throw new Error(`Missing ${label} button`);
  button.click();
}

function owner(status: "DRAFT" | "ARCHIVED") {
  return {
    bannerId: "banner-a",
    name: "Test banner",
    href: null,
    status,
    priority: 0,
    startsAt: Date.now(),
    endsAt: null,
    version: 1,
  };
}
it("treats a plain-text 413 as a rejected upload without retrying or locking the input", async () => {
  await act(async () => root.render(<BannerMediaEditor bannerId="banner-a" archived={false} />));
  const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(fileInput, "files", {
    value: [new File(["image"], "banner.png", { type: "image/png" })],
  });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  const description = document.querySelector<HTMLInputElement>(
    'input[placeholder="Describe what appears in the banner"]',
  )!;
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

it("retries an unknown upload with the same command identity", async () => {
  let uploadAttempt = 0;
  fetchMock.mockImplementation((_url, options) => {
    if (options?.method !== "POST") {
      return Promise.resolve(Response.json({ ok: true, requestId: "load", value: null }));
    }
    uploadAttempt += 1;
    if (uploadAttempt <= 2) return Promise.reject(new Error("connection lost"));
    return Promise.resolve(
      Response.json({
        ok: true,
        requestId: "saved",
        value: {
          bannerId: "banner-a",
          mediaId: "media-a",
          version: 1,
          altText: "Fresh produce",
          mimeType: "image/png",
          status: "active",
        },
      }),
    );
  });

  await act(async () => root.render(<BannerMediaEditor bannerId="banner-a" archived={false} />));
  const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(fileInput, "files", {
    value: [new File(["image"], "banner.png", { type: "image/png" })],
  });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  const description = document.querySelector<HTMLInputElement>(
    'input[placeholder="Describe what appears in the banner"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      description,
      "Fresh produce",
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save image"))!
      .click();
  });

  expect(document.body.textContent).toContain("Image outcome unknown");
  const unknownAttempts = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(unknownAttempts).toHaveLength(2);
  const commandKey = unknownAttempts[0]?.[1]?.headers?.["idempotency-key"];
  expect(unknownAttempts[1]?.[1]?.headers?.["idempotency-key"]).toBe(commandKey);

  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Check image status"))!
      .click();
  });
  const allAttempts = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(allAttempts).toHaveLength(3);
  expect(allAttempts[2]?.[1]?.headers?.["idempotency-key"]).toBe(commandKey);
  expect(document.body.textContent).toContain("Banner image saved.");
});

it("keeps the same upload intent locked when Core reports unconfirmed conflict", async () => {
  let uploads = 0;
  fetchMock.mockImplementation((url, options) => {
    if (url === "/api/admin/banners")
      return Promise.resolve(
        Response.json({ ok: true, requestId: "owner", value: { items: [owner("DRAFT")] } }),
      );
    if (options?.method !== "POST")
      return Promise.resolve(Response.json({ ok: true, requestId: "current", value: null }));
    uploads += 1;
    return Promise.resolve(
      uploads === 1
        ? Response.json({
            ok: false,
            error: { code: "CONFLICT", message: "Image upload is not confirmed", requestId: "c" },
          })
        : Response.json({
            ok: true,
            requestId: "saved",
            value: {
              bannerId: "banner-a",
              mediaId: "media-a",
              version: 1,
              altText: "Fresh produce",
              mimeType: "image/png",
              status: "active",
            },
          }),
    );
  });
  await act(async () => root.render(<BannerMediaEditor bannerId="banner-a" archived={false} />));
  await chooseImage();
  await act(async () => clickButton("Save image"));
  expect(document.body.textContent).toContain("Image outcome remains unconfirmed");
  expect(document.querySelector("fieldset")?.disabled).toBe(true);
  const firstKey = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")?.[1]
    ?.headers?.["idempotency-key"];
  await act(async () => clickButton("Check image status"));
  const attempts = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]?.[1]?.headers?.["idempotency-key"]).toBe(firstKey);
  expect(document.body.textContent).toContain("Banner image saved.");
});

it("reconciles a changed image after a conflict before allowing a new intent", async () => {
  let reads = 0;
  fetchMock.mockImplementation((_url, options) => {
    if (options?.method === "POST")
      return Promise.resolve(
        Response.json({
          ok: false,
          error: { code: "CONFLICT", message: "Image changed", requestId: "c" },
        }),
      );
    reads += 1;
    return Promise.resolve(
      Response.json({
        ok: true,
        requestId: "current",
        value:
          reads === 1
            ? null
            : {
                bannerId: "banner-a",
                mediaId: "other-media",
                version: 1,
                altText: "Other image",
                mimeType: "image/png",
                status: "active",
              },
      }),
    );
  });
  await act(async () => root.render(<BannerMediaEditor bannerId="banner-a" archived={false} />));
  await chooseImage();
  await act(async () => clickButton("Save image"));
  expect(document.body.textContent).toContain("The banner image changed");
  expect(document.querySelector<HTMLImageElement>("img")?.alt).toBe("Other image");
  expect(document.querySelector("fieldset")?.disabled).toBe(false);
  expect(document.body.textContent).not.toContain("Image outcome remains unconfirmed");
});

it("stops an upload intent when a conflict reveals an archived banner", async () => {
  const onChange = vi.fn();
  fetchMock.mockImplementation((url, options) => {
    if (url === "/api/admin/banners")
      return Promise.resolve(
        Response.json({ ok: true, requestId: "owner", value: { items: [owner("ARCHIVED")] } }),
      );
    if (options?.method === "POST")
      return Promise.resolve(
        Response.json({
          ok: false,
          error: { code: "CONFLICT", message: "Banner archived", requestId: "c" },
        }),
      );
    return Promise.resolve(Response.json({ ok: true, requestId: "current", value: null }));
  });
  await act(async () =>
    root.render(<BannerMediaEditor bannerId="banner-a" archived={false} onChange={onChange} />),
  );
  await chooseImage();
  await act(async () => clickButton("Save image"));
  expect(document.body.textContent).toContain("This banner was archived");
  expect(document.body.textContent).not.toContain("Image outcome remains unconfirmed");
  expect(onChange).toHaveBeenCalledOnce();
});
