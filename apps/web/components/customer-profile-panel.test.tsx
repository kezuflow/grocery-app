// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CustomerProfilePanel } from "./customer-profile-panel";
vi.mock("../lib/auth/auth-client", () => ({ authClient: {} }));
it("formats typing without a save and removes the language control", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CustomerProfilePanel
        initial={{
          customerId: "test",
          accountPhone: null,
          defaultAddressId: null,
          preferredLanguage: "Cebuano",
          promotionalEmails: false,
          version: 1,
        }}
      />,
    ),
  );
  const input = host.querySelector<HTMLInputElement>("#account-phone")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "09171234567",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe("+63 917 123 4567");
  expect(host.querySelector("#preferred-language")).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
