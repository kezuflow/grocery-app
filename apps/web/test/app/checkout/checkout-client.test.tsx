import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- the bundled jsdom test runtime does not publish declarations.
import { JSDOM } from "jsdom";
import type { CustomerAddressView } from "@freshmarkets/contracts";

const { addressEditorPropsMock, fetchCartMock } = vi.hoisted(() => ({
  addressEditorPropsMock: vi.fn(),
  fetchCartMock: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/storefront/cart-client", () => ({ fetchCart: fetchCartMock }));
vi.mock("@/components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/storefront/marketplace/order-summary", () => ({
  OrderSummary: () => null,
}));
vi.mock("@/components/storefront/address/address-editor", () => ({
  AddressEditor: ({
    initialAddress,
    multiStep,
    onConfirmed,
  }: {
    initialAddress?: CustomerAddressView;
    multiStep?: boolean;
    onConfirmed?: (addressId: string) => void;
  }) => {
    addressEditorPropsMock({ initialAddress, multiStep });
    return (
      <button type="button" onClick={() => onConfirmed?.(initialAddress?.id ?? "address-new")}>
        Complete checkout address save
      </button>
    );
  },
}));

import { CheckoutClient } from "@/app/checkout/checkout-client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://freshmarkets.ph/checkout",
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

const home = address("address-home", "Home", true);
const office = address("address-office", "Office", true);

function address(id: string, label: string, serviceable: boolean): CustomerAddressView {
  return {
    id,
    label,
    recipient: "Ana Santos",
    phone: "+639171234567",
    components: {
      addressLine1: `${label} destination`,
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
      landmark: null,
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    },
    latitude: 10.3173,
    longitude: 123.9058,
    serviceable,
    serviceabilityReason: serviceable ? null : "OUTSIDE_SERVICE_AREA",
    serviceAreaCode: serviceable ? "CEBU_CITY" : null,
    deliveryZoneCode: serviceable ? "CEBU_CITY_CORE" : null,
    resolutionVersion: 1,
    status: "active",
    version: 2,
  };
}

function json(value: unknown): Response {
  return Response.json(value);
}

function addressesResponse(addresses: ReadonlyArray<CustomerAddressView>): Response {
  return json({ ok: true, value: addresses, requestId: crypto.randomUUID() });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function click(container: HTMLElement, label: string): void {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    `${candidate.textContent} ${candidate.getAttribute("aria-label") ?? ""}`.includes(label),
  );
  if (!button) throw new Error(`Missing button ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function choose(container: HTMLElement, label: string): void {
  let radio = Array.from(container.querySelectorAll('input[type="radio"]')).find((candidate) =>
    candidate.parentElement?.textContent?.includes(label),
  );
  if (!radio) {
    const change = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === "Change saved address",
    );
    if (change) act(() => change.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    radio = Array.from(container.querySelectorAll('input[type="radio"]')).find((candidate) =>
      candidate.parentElement?.textContent?.includes(label),
    );
  }
  if (!radio) throw new Error(`Missing address ${label}`);
  act(() => radio.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function successfulFetch(options?: {
  addresses?: ReadonlyArray<CustomerAddressView>;
  onQuote?: (init?: RequestInit) => void;
}) {
  return vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/checkout/fulfillment-options")
      return Promise.resolve(
        json({
          ok: true,
          value: [
            {
              optionId: "option-instant",
              mode: "INSTANT",
              eligible: true,
              unavailableReason: null,
              promisedAt: "2026-09-01T01:00:00Z",
              deliveryWindow: null,
              feePreview: {
                subtotalMinor: 2000,
                discountMinor: 0,
                totalMinor: 2000,
                currency: "PHP",
              },
              cycleId: null,
              cutoffAt: null,
              provisional: true,
            },
            {
              optionId: "option-scheduled",
              mode: "SCHEDULED",
              eligible: true,
              unavailableReason: null,
              promisedAt: null,
              deliveryWindow: { startsAt: "2026-09-05T00:00:00Z", endsAt: "2026-09-06T00:00:00Z" },
              feePreview: {
                subtotalMinor: 3000,
                discountMinor: 0,
                totalMinor: 3000,
                currency: "PHP",
              },
              cycleId: "cycle-2",
              cutoffAt: "2026-09-04T00:00:00Z",
              provisional: true,
            },
          ],
        }),
      );
    if (path === "/api/commerce/address")
      return Promise.resolve(addressesResponse(options?.addresses ?? [home, office]));
    if (path === "/api/commerce/profile")
      return Promise.resolve(
        json({
          ok: true,
          value: {
            customerId: "customer",
            accountPhone: null,
            defaultAddressId: null,
            preferredLanguage: null,
            promotionalEmails: false,
            version: 1,
          },
          requestId: "profile",
        }),
      );
    if (path === "/api/commerce/checkout")
      return Promise.resolve(
        json({ ok: true, value: { eligible: true, failures: [] }, requestId: "eligible" }),
      );
    if (path === "/api/checkout/quote") {
      options?.onQuote?.(init);
      const input = JSON.parse(String(init?.body)) as {
        fulfillmentOptionId: string;
        promotionCodes?: string[];
      };
      const optionId = input.fulfillmentOptionId;
      const totalMinor = optionId === "option-instant" ? 32000 : 33000;
      return Promise.resolve(
        json({
          ok: true,
          value: {
            quoteId: `quote-${optionId}`,
            attemptVersion: 1,
            priceAcceptanceVersion: 1,
            expiresAt: "2026-09-01T00:00:00.000Z",
            currency: "PHP",
            merchandiseSubtotalMinor: 30000,
            itemDiscountMinor: 0,
            orderDiscountMinor: 0,
            deliverySubtotalMinor: totalMinor - 30000,
            deliveryDiscountMinor: 0,
            taxMinor: 0,
            subtotalMinor: 30000,
            discountMinor: 0,
            deliveryFeeMinor: totalMinor - 30000,
            totalMinor,
            lines: [],
            requestedPromotionCodes: input.promotionCodes ?? [],
            promotionFeedback: (input.promotionCodes ?? []).map((code) => ({
              code,
              status: "APPLIED",
              message: "Promotion applied",
            })),
            promotionApplications: [],
          },
        }),
      );
    }
    if (path.endsWith("/abandon"))
      return Promise.resolve(json({ ok: true, value: { outcome: "ABANDONED" } }));
    if (path === "/api/checkout/payment") return Promise.resolve(json({ ok: true }));
    throw new Error(`Unexpected request ${path}`);
  });
}

describe("CheckoutClient delivery inputs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchCartMock.mockResolvedValue({
      id: "cart-1",
      version: 4,
      items: [
        {
          skuId: "sku-1",
          quantity: 1,
          name: "Produce",
          unitPriceMinor: 30000,
          lineTotalMinor: 30000,
        },
      ],
      totalMinor: 30000,
      currency: "PHP",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    addressEditorPropsMock.mockReset();
    fetchCartMock.mockReset();
  });

  it("invalidates the quote and rotates idempotency when a different address is selected", async () => {
    const quoteKeys: string[] = [];
    vi.stubGlobal(
      "fetch",
      successfulFetch({
        onQuote: (init) =>
          quoteKeys.push(String(new Headers(init?.headers).get("idempotency-key"))),
      }),
    );
    act(() => root.render(<CheckoutClient />));
    await flush();

    choose(container, "Home");
    await flush();
    click(container, "Instant delivery");
    await flush();
    expect(container.textContent).toContain("PHP 320.00");

    choose(container, "Office");
    await flush();
    expect(container.textContent).not.toContain("PHP 320.00");
    click(container, "Instant delivery");
    await flush();

    expect(quoteKeys).toHaveLength(2);
    expect(quoteKeys[1]).not.toBe(quoteKeys[0]);
  });

  it("invalidates the quote and rotates idempotency after correcting the same address ID", async () => {
    const quoteKeys: string[] = [];
    vi.stubGlobal(
      "fetch",
      successfulFetch({
        onQuote: (init) =>
          quoteKeys.push(String(new Headers(init?.headers).get("idempotency-key"))),
      }),
    );
    act(() => root.render(<CheckoutClient />));
    await flush();

    choose(container, "Home");
    await flush();
    click(container, "Instant delivery");
    await flush();
    click(container, "Edit Home address");
    click(container, "Complete checkout address save");
    await flush();

    expect(container.textContent).not.toContain("PHP 320.00");
    await flush();
    click(container, "Instant delivery");
    await flush();
    expect(quoteKeys[1]).not.toBe(quoteKeys[0]);
  });

  it("invalidates the old quote immediately and rotates idempotency for a different cycle", async () => {
    const quoteKeys: string[] = [];
    const base = successfulFetch({
      onQuote: (init) => quoteKeys.push(String(new Headers(init?.headers).get("idempotency-key"))),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        return base(url, init);
      }),
    );
    act(() => root.render(<CheckoutClient />));
    await flush();

    choose(container, "Home");
    await flush();
    click(container, "Instant delivery");
    await flush();
    expect(container.textContent).toContain("PHP 320.00");

    click(container, "Scheduled delivery");
    await flush();
    expect(container.textContent).not.toContain("PHP 320.00");
    expect(quoteKeys[1]).not.toBe(quoteKeys[0]);
    expect(container.textContent).toContain("PHP 330.00");
  });

  it("loads delivery options when the cart arrives after address selection", async () => {
    const cart = await fetchCartMock();
    const pendingCart = deferred<typeof cart>();
    fetchCartMock.mockReturnValue(pendingCart.promise);
    const base = successfulFetch();
    vi.stubGlobal("fetch", base);
    act(() => root.render(<CheckoutClient />));
    await flush();
    choose(container, "Home");
    await flush();
    expect(
      base.mock.calls.filter(([url]) => String(url).includes("fulfillment-options")),
    ).toHaveLength(0);
    await act(async () => pendingCart.resolve(cart));
    await flush();
    expect(
      base.mock.calls.filter(([url]) => String(url).includes("fulfillment-options")),
    ).toHaveLength(1);
    click(container, "Instant delivery");
    await flush();
    expect(container.textContent).toContain("Payment review");
  });
  it("retains a quote after an unknown release response and retries the identical request before replacement", async () => {
    const quotes: string[] = [],
      releases: Array<{ key: string; body: string }> = [];
    const base = successfulFetch({ onQuote: (init) => quotes.push(String(init?.body)) });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/abandon")) {
          releases.push({
            key: new Headers(init?.headers).get("idempotency-key") ?? "",
            body: String(init?.body),
          });
          if (releases.length === 1)
            return Promise.reject(new Error("Response lost after acceptance"));
        }
        return base(url, init);
      }),
    );
    act(() => root.render(<CheckoutClient />));
    await flush();
    choose(container, "Home");
    await flush();
    click(container, "Instant delivery");
    await flush();
    choose(container, "Office");
    await flush();
    expect(container.textContent).toContain("could not be released safely");
    expect(container.textContent).toContain("Payment review");
    expect(quotes).toHaveLength(1);
    click(container, "Discard current total and start again");
    await flush();
    expect(releases).toHaveLength(2);
    expect(releases[1]).toEqual(releases[0]);
    expect(container.textContent).not.toContain("Payment review");
    choose(container, "Office");
    await flush();
    click(container, "Instant delivery");
    await flush();
    expect(quotes).toHaveLength(2);
  });
  it("normalizes promotion input and invalidates an accepted quote when codes change", async () => {
    const quoteBodies: Array<{ promotionCodes?: string[] }> = [];
    vi.stubGlobal(
      "fetch",
      successfulFetch({
        onQuote: (init) => quoteBodies.push(JSON.parse(String(init?.body))),
      }),
    );
    act(() => root.render(<CheckoutClient />));
    await flush();

    choose(container, "Home");
    await flush();
    click(container, "Instant delivery");
    await flush();
    expect(container.textContent).toContain("Payment review");

    const input = container.querySelector<HTMLInputElement>("#promotion-code");
    if (!input) throw new Error("Missing promotion input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        " save10 ",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(container, "Add code");
    await flush();

    expect(container.textContent).not.toContain("Payment review");
    expect(container.textContent).toContain("SAVE10 added");
    click(container, "Instant delivery");
    await flush();
    expect(quoteBodies.at(-1)?.promotionCodes).toEqual(["SAVE10"]);

    click(container, "Remove SAVE10 promotion code");
    await flush();
    expect(container.textContent).not.toContain("Payment review");
  });

  it("ignores an older initial address response after a current post-save refresh", async () => {
    const initial = deferred<Response>();
    const refreshed = deferred<Response>();
    let addressCalls = 0;
    const base = successfulFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/commerce/address")
          return ++addressCalls === 1 ? initial.promise : refreshed.promise;
        return base(url, init);
      }),
    );
    act(() => root.render(<CheckoutClient />));
    await flush();
    click(container, "Add delivery address");
    expect(addressEditorPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ multiStep: true }),
    );
    click(container, "Complete checkout address save");

    refreshed.resolve(addressesResponse([{ ...home, id: "address-new", label: "Current" }]));
    await flush();
    initial.resolve(addressesResponse([{ ...home, label: "Stale" }]));
    await flush();

    expect(container.textContent).toContain("Current");
    expect(container.textContent).not.toContain("Stale");
  });
});
