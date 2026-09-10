// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CustomerProfilePanel } from "./customer-profile-panel";
const updateName = vi.hoisted(() => vi.fn());
vi.mock("../lib/auth/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: "Test", email: "test@example.invalid" } },
      isPending: false,
      refetch: vi.fn(),
    }),
    updateUser: updateName,
  },
}));
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

it("uses one Save and retries the contact write without repeating a confirmed name save", async () => {
  const profile = {
    customerId: "test",
    accountPhone: null,
    defaultAddressId: null,
    preferredLanguage: null,
    promotionalEmails: false,
    version: 1,
  };
  updateName.mockReset().mockResolvedValue({ error: null });
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce({ json: async () => ({ ok: true, value: { ...profile, version: 2 } }) });
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CustomerProfilePanel initial={profile} />));
    expect(host.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    const name = host.querySelector<HTMLInputElement>("#account-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Updated",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await act(async () => {
      submit();
    });
    expect(updateName).toHaveBeenCalledWith({ name: "Updated" });
    expect(host.textContent).not.toContain("Account details saved.");
    expect(host.textContent).toContain("Retry saving");
    await act(async () => {
      submit();
    });
    expect(updateName).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toEqual(request.mock.calls[1][1]);
    expect(host.textContent).toContain("Account details saved.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
