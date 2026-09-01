import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- the bundled jsdom test runtime does not publish declarations.
import { JSDOM } from "jsdom";
import type { CustomerAddressView } from "@freshmarkets/contracts";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/storefront/address/address-editor", () => ({
  AddressEditor: ({
    initialAddress,
    onConfirmed,
  }: {
    initialAddress?: CustomerAddressView;
    onConfirmed?: (addressId: string) => void;
  }) => (
    <div>
      <p>
        {initialAddress
          ? `Editing ${initialAddress.label} version ${initialAddress.version}`
          : "New address editor"}
      </p>
      <button type="button" onClick={() => onConfirmed?.(initialAddress?.id ?? "address-new")}>
        Complete address save
      </button>
    </div>
  ),
}));

import { AddressBookClient } from "@/app/account/addresses/address-book-client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://freshmarkets.ph/account/addresses",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Event",
  "MouseEvent",
] as const)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: dom.window[name],
  });

const baseAddress: CustomerAddressView = {
  id: "address-home",
  label: "Home",
  recipient: "Ana Santos",
  phone: "+639171234567",
  components: {
    addressLine1: "Ayala Center Cebu",
    addressLine2: null,
    barangay: "Luz",
    city: "Cebu City",
    region: "Central Visayas",
    postalCode: "6000",
    countryCode: "PH",
  },
  confirmationSource: "USER_PIN",
  confirmedAt: "2026-08-30T00:00:00.000Z",
  instructions: {
    buildingUnit: null,
    landmark: "Main entrance",
    gateGuard: null,
    deliveryNote: null,
    recipientInstruction: null,
  },
  latitude: 10.3173,
  longitude: 123.9058,
  serviceable: true,
  serviceabilityReason: null,
  serviceAreaCode: "CEBU_CITY",
  deliveryZoneCode: "CEBU_CITY_CORE",
  resolutionVersion: 1,
  status: "active",
  version: 2,
};

function response(addresses: ReadonlyArray<CustomerAddressView>): Response {
  return Response.json({ ok: true, value: addresses, requestId: crypto.randomUUID() });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function click(container: HTMLElement, label: string): void {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    `${candidate.textContent} ${candidate.getAttribute("aria-label") ?? ""}`.includes(label),
  );
  if (!button) throw new Error(`Missing button ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("AddressBookClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens a serviceable saved address in the versioned editor and refreshes after save", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([baseAddress]))
      .mockResolvedValueOnce(response([{ ...baseAddress, recipient: "Bea Santos", version: 3 }]));
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<AddressBookClient />));
    await flush();
    click(container, "Edit Home address");

    expect(container.textContent).toContain("Edit Home");
    expect(container.textContent).toContain("Editing Home version 2");
    click(container, "Complete address save");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Bea Santos");
    expect(container.textContent).toContain("Delivery address saved and refreshed");
  });

  it("ignores an older initial address response that resolves after a post-save refresh", async () => {
    const initial = deferred<Response>();
    const refreshed = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise);
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<AddressBookClient />));
    click(container, "Complete address save");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    refreshed.resolve(response([{ ...baseAddress, id: "address-new", label: "Current" }]));
    await flush();
    initial.resolve(response([{ ...baseAddress, label: "Stale" }]));
    await flush();

    expect(container.textContent).toContain("Current");
    expect(container.textContent).not.toContain("Stale");
  });
});
