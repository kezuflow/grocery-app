import { act, createElement, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- the bundled jsdom test runtime does not publish declarations.
import { JSDOM } from "jsdom";
import type { CustomerAddressView, FulfillmentOptionView } from "@freshmarkets/contracts";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient, queryKeys } from "@/lib/query/query-client";

const { addressEditorPropsMock, fetchCartMock, orderSummaryPropsMock, refreshCartForLocationMock } =
  vi.hoisted(() => ({
    addressEditorPropsMock: vi.fn(),
    fetchCartMock: vi.fn(),
    orderSummaryPropsMock: vi.fn(),
    refreshCartForLocationMock: vi.fn(),
  }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/storefront/cart-client", () => ({
  fetchCart: fetchCartMock,
  refreshCartForLocation: refreshCartForLocationMock,
  cartLoadError: () => "",
  CART_CHANGED_EVENT: "fm:cart-changed",
}));
vi.mock("@/components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/storefront/marketplace/order-summary", () => ({
  OrderSummary: (props: { onAction?: () => Promise<void> }) => {
    orderSummaryPropsMock(props);
    return null;
  },
}));
vi.mock("@/components/storefront/address/address-editor", () => ({
  AddressEditor: ({
    initialAddress,
    initialDestination,
    multiStep,
    onConfirmed,
  }: {
    initialAddress?: CustomerAddressView;
    initialDestination?: { displayAddress: string };
    multiStep?: boolean;
    onConfirmed?: (addressId: string) => void;
  }) => {
    addressEditorPropsMock({ initialAddress, initialDestination, multiStep });
    return (
      <button type="button" onClick={() => onConfirmed?.(initialAddress?.id ?? "address-new")}>
        Complete checkout address save
      </button>
    );
  },
}));

import { CheckoutClient } from "@/app/(storefront)/checkout/checkout-client";

const checkout = (client: QueryClient = createQueryClient()) => (
  <QueryClientProvider client={client}>
    <CheckoutClient />
  </QueryClientProvider>
);

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
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: dom.window.localStorage,
});

const home = address("address-home", "Home", true);
const office = address("address-office", "Office", true);

function instantOption(
  optionId: string,
  code: "lalamove" | "grab-express",
  displayName: string,
  serviceType: string,
  eligible = true,
): FulfillmentOptionView {
  return {
    optionId,
    mode: "INSTANT",
    eligible,
    unavailableReason: eligible ? null : "DELIVERY_PARTNER_UNAVAILABLE",
    deliveryPartner: { code, displayName, serviceType, serviceLabel: "Motorcycle" },
    promisedAt: "2026-09-01T01:00:00Z",
    deliveryWindow: null,
    feePreview: null,
    cycleId: null,
    cutoffAt: null,
    provisional: true,
  };
}

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
      deliveryInstructions: null,
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
  return json({
    ok: true,
    value: {
      addresses,
      profile: {
        customerId: "customer",
        accountPhone: null,
        defaultAddressId: null,
        preferredLanguage: null,
        promotionalEmails: false,
        version: 1,
      },
    },
    requestId: crypto.randomUUID(),
  });
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
              deliveryPartner: {
                code: "lalamove",
                displayName: "Lalamove",
                serviceType: "MOTORCYCLE",
                serviceLabel: "Motorcycle",
              },
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
    if (path === "/api/checkout/bootstrap")
      return Promise.resolve(addressesResponse(options?.addresses ?? [home, office]));
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
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
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
    refreshCartForLocationMock.mockImplementation(() => fetchCartMock());
    window.localStorage.clear();
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
    orderSummaryPropsMock.mockReset();
    fetchCartMock.mockReset();
    refreshCartForLocationMock.mockReset();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("leaves checkout and never requests another quote while payment is in progress", async () => {
    const cart = await fetchCartMock();
    fetchCartMock.mockResolvedValue({ ...cart, paymentInProgress: true });
    window.sessionStorage.setItem(
      "freshmarkets.checkoutPaymentAction",
      JSON.stringify({
        paymentIntentId: "payment-1",
        state: "REQUIRES_ACTION",
        actionType: "SDK",
        redirectUrl: null,
        clientToken: "client-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const base = successfulFetch();
    vi.stubGlobal("fetch", base);

    act(() => root.render(checkout()));
    await flush();
    await flush();

    expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
      0,
    );
    expect(container.textContent).not.toContain("Try quotation again");
  });

  it("uses authenticated payment recovery when continuation storage cannot be read or cleared", async () => {
    const cart = await fetchCartMock();
    fetchCartMock.mockResolvedValue({ ...cart, paymentInProgress: true });
    vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(window.Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const base = successfulFetch();
    vi.stubGlobal("fetch", base);

    act(() => root.render(checkout()));
    await flush();
    await flush();

    expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
      0,
    );
    expect(container.textContent).not.toContain("Try quotation again");
  });

  it("continues after accepted payment when continuation storage cannot be written", async () => {
    const base = successfulFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/payment")
          return Promise.resolve(
            json({
              ok: true,
              value: {
                paymentIntentId: "payment-1",
                state: "REQUIRES_ACTION",
                actionType: "SDK",
                redirectUrl: null,
                clientToken: "client-token",
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              },
              requestId: "payment",
            }),
          );
        return base(url, init);
      }),
    );
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    await vi.waitFor(() =>
      expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
        1,
      ),
    );
    click(container, "QR Ph");
    await flush();
    const storageWrite = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const props = orderSummaryPropsMock.mock.lastCall?.[0] as {
      onAction?: () => Promise<void>;
    };
    if (!props.onAction) throw new Error("Missing checkout payment action");

    await act(props.onAction);

    expect(storageWrite).toHaveBeenCalledWith(
      "freshmarkets.checkoutPaymentAction",
      expect.any(String),
    );
    expect(container.textContent).not.toContain("storage unavailable");
    expect(container.textContent).not.toContain("Payments are unavailable");
  });

  it("fails closed on an empty payment response and retries the same payment identity", async () => {
    const paymentKeys: string[] = [];
    const base = successfulFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/payment") {
          paymentKeys.push(String(new Headers(init?.headers).get("idempotency-key")));
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return base(url, init);
      }),
    );
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    await vi.waitFor(() =>
      expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
        1,
      ),
    );
    click(container, "QR Ph");
    await flush();

    const submit = () => {
      const props = orderSummaryPropsMock.mock.lastCall?.[0] as {
        onAction?: () => Promise<void>;
      };
      if (!props.onAction) throw new Error("Missing checkout payment action");
      return props.onAction();
    };
    await act(submit);
    expect(container.textContent).toContain("same payment request will be safely reused");
    await act(submit);
    expect(paymentKeys).toHaveLength(2);
    expect(paymentKeys[1]).toBe(paymentKeys[0]);
  });

  it("keeps an unsaved Deliver to destination visible beside saved alternatives", async () => {
    window.localStorage.setItem(
      "freshmarkets.delivery-location.v3",
      JSON.stringify({
        displayAddress: "IT Park entrance, Cebu City",
        coordinate: { latitude: 10.329, longitude: 123.906 },
        savedAddressId: null,
      }),
    );
    vi.stubGlobal("fetch", successfulFetch());

    act(() => root.render(checkout()));
    await flush();

    expect(container.textContent).toContain("IT Park entrance, Cebu City");
    expect(container.textContent).toContain("Complete delivery details");
    expect(container.textContent).toContain("Home");
    expect(container.textContent).toContain("Office");
    expect(container.textContent).not.toContain("Complete checkout address save");

    click(container, "Complete delivery details");
    expect(addressEditorPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialAddress: undefined,
        initialDestination: expect.objectContaining({
          displayAddress: "IT Park entrance, Cebu City",
        }),
        multiStep: true,
      }),
    );
  });

  it("hydrates deterministically before reading the carried browser destination", async () => {
    const client = createQueryClient();
    const storedLocalStorage = globalThis.localStorage;
    Reflect.deleteProperty(globalThis, "localStorage");
    let serverMarkup: string;
    try {
      serverMarkup = renderToString(checkout(client));
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: storedLocalStorage,
      });
    }
    window.localStorage.setItem(
      "freshmarkets.delivery-location.v3",
      JSON.stringify({
        displayAddress: "Hydrated destination, Cebu City",
        coordinate: { latitude: 10.329, longitude: 123.906 },
        savedAddressId: null,
      }),
    );
    vi.stubGlobal("fetch", successfulFetch());
    const onRecoverableError = vi.fn();

    act(() => root.unmount());
    container.innerHTML = serverMarkup;
    await act(async () => {
      root = hydrateRoot(container, checkout(client), { onRecoverableError });
      await Promise.resolve();
    });
    await flush();

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Hydrated destination, Cebu City");
  });

  it("prefers a current explicit Deliver to identity over an older checkout draft", async () => {
    window.localStorage.setItem(
      "freshmarkets.delivery-location.v3",
      JSON.stringify({
        displayAddress: "Home destination",
        coordinate: { latitude: home.latitude, longitude: home.longitude },
        savedAddressId: home.id,
      }),
    );
    const client = createQueryClient();
    client.setQueryData(queryKeys.private(0, "checkout-draft"), {
      cartId: "cart-1",
      addressId: office.id,
      promotionCodes: [],
    });
    vi.stubGlobal("fetch", successfulFetch());

    act(() => root.render(checkout(client)));
    await flush();

    const savedChoices = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    expect(savedChoices.find((choice) => choice.value === home.id)?.checked).toBe(true);
    expect(savedChoices.find((choice) => choice.value === office.id)?.checked).toBe(false);
  });

  it("quotes a Scheduled-only Core configuration and keeps its cutoff visible", async () => {
    let quoteCalls = 0;
    const base = successfulFetch({ onQuote: () => (quoteCalls += 1) });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const path = String(url);
        if (path === "/api/checkout/fulfillment-options")
          return Promise.resolve(
            json({
              ok: true,
              value: [
                {
                  optionId: "option-scheduled",
                  mode: "SCHEDULED",
                  eligible: true,
                  unavailableReason: null,
                  deliveryPartner: {
                    code: "lalamove",
                    displayName: "Lalamove",
                    serviceType: "MOTORCYCLE",
                    serviceLabel: "Motorcycle",
                  },
                  promisedAt: null,
                  deliveryWindow: {
                    windowId: "window-1",
                    name: "Scheduled delivery",
                    startsAt: "2026-09-20T00:00:00Z",
                    endsAt: "2026-09-20T14:00:00Z",
                  },
                  feePreview: null,
                  cycleId: "cycle-2",
                  cutoffAt: "2026-09-19T00:00:00Z",
                  provisional: true,
                },
              ],
            }),
          );
        return base(url, init);
      }),
    );

    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    await flush();

    expect(quoteCalls).toBe(1);
    expect(container.textContent).toContain("Scheduled delivery");
    expect(container.textContent).toContain("Order cutoff");
    expect(container.textContent).not.toContain("Delivery fee confirmed with Lalamove.");
    expect(container.textContent).toContain("₱30.00");
    expect(container.textContent).toContain("Scheduled delivery cutoff: Friday, 11:59 PM.");
    expect(container.textContent).toContain("following Saturday or Sunday");
    expect(container.textContent).not.toContain("Instant checkout is unavailable");
  });

  it("refreshes the accepted Instant quote at the provider-expiry safety boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T00:00:00.000Z"));
    let quoteCalls = 0;
    let abandonCalls = 0;
    const base = successfulFetch({ onQuote: () => (quoteCalls += 1) });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/abandon")) abandonCalls += 1;
        return base(url, init);
      }),
    );

    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    await flush();
    expect(quoteCalls).toBe(1);
    expect(container.textContent).toContain("Refreshes in 04:30");

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(container.textContent).toContain("Refreshes in 04:00");
    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000));
    await flush();

    expect(abandonCalls).toBe(1);
    expect(quoteCalls).toBe(2);
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
    act(() => root.render(checkout()));
    await flush();

    choose(container, "Home");
    await flush();
    await vi.waitFor(() => expect(quoteKeys).toHaveLength(1));
    expect(container.textContent).not.toContain("Delivery fee confirmed with Lalamove");

    choose(container, "Office");
    await flush();
    await vi.waitFor(() => expect(quoteKeys).toHaveLength(2));

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
    act(() => root.render(checkout()));
    await flush();

    choose(container, "Home");
    await flush();
    await vi.waitFor(() => expect(quoteKeys).toHaveLength(1));
    click(container, "Edit Home address");
    click(container, "Complete checkout address save");
    await flush();

    await vi.waitFor(() => expect(quoteKeys).toHaveLength(2));
    expect(quoteKeys[1]).not.toBe(quoteKeys[0]);
  });

  it("changes couriers immediately and rotates quote identity", async () => {
    const quoteKeys: string[] = [];
    const base = successfulFetch({
      onQuote: (init) => quoteKeys.push(String(new Headers(init?.headers).get("idempotency-key"))),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/fulfillment-options")
          return Promise.resolve(
            json({
              ok: true,
              value: [
                {
                  optionId: "option-instant",
                  mode: "INSTANT",
                  eligible: true,
                  unavailableReason: null,
                  deliveryPartner: {
                    code: "lalamove",
                    displayName: "Lalamove",
                    serviceType: "MOTORCYCLE",
                    serviceLabel: "Motorcycle",
                  },
                  promisedAt: "2026-09-01T01:00:00Z",
                  deliveryWindow: null,
                  feePreview: null,
                  cycleId: null,
                  cutoffAt: null,
                  provisional: true,
                },
                {
                  optionId: "option-grab",
                  mode: "INSTANT",
                  eligible: true,
                  unavailableReason: null,
                  deliveryPartner: {
                    code: "grab-express",
                    displayName: "GrabExpress",
                    serviceType: "INSTANT",
                    serviceLabel: "Bike",
                  },
                  promisedAt: "2026-09-01T01:10:00Z",
                  deliveryWindow: null,
                  feePreview: null,
                  cycleId: null,
                  cutoffAt: null,
                  provisional: true,
                },
              ],
            }),
          );
        return base(url, init);
      }),
    );
    act(() => root.render(checkout()));
    await flush();

    choose(container, "Home");
    await flush();
    await vi.waitFor(() => expect(quoteKeys).toHaveLength(1));

    click(container, "GrabExpress");
    await vi.waitFor(() => expect(quoteKeys).toHaveLength(2));
    expect(quoteKeys[1]).not.toBe(quoteKeys[0]);
    expect(container.textContent).not.toContain("Delivery fee confirmed with GrabExpress");
  });

  it("preserves explicit provider and service intent across refreshed opaque option IDs", async () => {
    const base = successfulFetch();
    let optionReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/fulfillment-options") {
          optionReads += 1;
          const suffix = optionReads === 1 ? "old" : "new";
          return Promise.resolve(
            json({
              ok: true,
              value: [
                instantOption(`lalamove-${suffix}`, "lalamove", "Lalamove", "MOTORCYCLE"),
                instantOption(`grab-${suffix}`, "grab-express", "GrabExpress", "INSTANT"),
              ],
            }),
          );
        }
        return base(url, init);
      }),
    );

    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    const initialChoice = Array.from(container.querySelectorAll('[role="radio"]')).find((choice) =>
      choice.textContent?.includes("Lalamove"),
    );
    expect(initialChoice?.getAttribute("aria-checked")).toBe("true");
    click(container, "GrabExpress");
    await flush();

    choose(container, "Office");
    await flush();

    const grabChoice = Array.from(container.querySelectorAll('[role="radio"]')).find((choice) =>
      choice.textContent?.includes("GrabExpress"),
    );
    expect(grabChoice?.getAttribute("aria-checked")).toBe("true");
    expect(grabChoice?.getAttribute("disabled")).toBeNull();
  });

  it("loads delivery options when the cart arrives after address selection", async () => {
    const cart = await fetchCartMock();
    const pendingCart = deferred<typeof cart>();
    fetchCartMock.mockReturnValue(pendingCart.promise);
    const base = successfulFetch();
    vi.stubGlobal("fetch", base);
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    expect(
      base.mock.calls.filter(([url]) => String(url).includes("fulfillment-options")),
    ).toHaveLength(0);
    await act(async () => pendingCart.resolve(cart));
    await flush();
    await vi.waitFor(() =>
      expect(
        base.mock.calls.filter(([url]) => String(url).includes("fulfillment-options")),
      ).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
        1,
      ),
    );
    expect(container.textContent).not.toContain("Delivery fee confirmed with Lalamove");
  });
  it("shows the delivery error beside a confirmed address and retries with fresh input versions", async () => {
    const base = successfulFetch();
    let optionCalls = 0;
    const requests: Array<{ cartVersion: number }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/fulfillment-options") {
          requests.push(JSON.parse(String(init?.body)));
          if (++optionCalls === 1)
            return Promise.resolve(
              json({
                ok: false,
                error: {
                  code: "STALE_VERSION",
                  message: "Address or cart changed",
                  requestId: "test",
                },
              }),
            );
        }
        return base(url, init);
      }),
    );
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Address or cart changed",
    );
    expect(container.textContent).not.toContain("Select a confirmed address to load");
    const cart = await fetchCartMock();
    fetchCartMock.mockResolvedValue({ ...cart, version: 5 });
    click(container, "Retry delivery options");
    await flush();
    expect(requests.at(-1)?.cartVersion).toBe(5);
    await vi.waitFor(() =>
      expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
        1,
      ),
    );
    expect(container.textContent).not.toContain("Delivery fee confirmed with Lalamove");
  });

  it("clears old options while a new address loads and discards the older response", async () => {
    const base = successfulFetch();
    const pending = deferred<Response>();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/fulfillment-options" && ++calls === 2)
          return pending.promise;
        return base(url, init);
      }),
    );
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    choose(container, "Office");
    await flush();
    expect(container.textContent).toContain("Loading delivery options");
    expect(container.textContent).not.toContain("Lalamove");
    choose(container, "Home");
    await flush();
    pending.resolve(json({ ok: true, value: [] }));
    await flush();
    expect(container.textContent).toContain("Lalamove");
  });

  it("offers recovery for network failure and distinguishes a successful empty result", async () => {
    const base = successfulFetch();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/fulfillment-options")
          return ++calls === 1
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(json({ ok: true, value: [] }));
        return base(url, init);
      }),
    );
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    click(container, "Retry delivery options");
    await flush();
    expect(container.textContent).toContain("No delivery options are available");
    expect(container.textContent).not.toContain("Select a confirmed address to load");
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
    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await vi.waitFor(() => expect(quotes).toHaveLength(1));
    choose(container, "Office");
    await flush();
    expect(container.textContent).not.toContain("could not be released safely");
    expect(quotes).toHaveLength(1);
    choose(container, "Office");
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(releases).toHaveLength(2);
    expect(releases[1]).toEqual(releases[0]);
    await vi.waitFor(() => expect(quotes).toHaveLength(2));
  });
  it("reacts to shared Cart promotion intent and invalidates an accepted quote", async () => {
    const quoteBodies: Array<{ promotionCodes?: string[] }> = [];
    vi.stubGlobal(
      "fetch",
      successfulFetch({
        onQuote: (init) => quoteBodies.push(JSON.parse(String(init?.body))),
      }),
    );
    const client = createQueryClient();
    act(() => root.render(checkout(client)));
    await flush();

    choose(container, "Home");
    await vi.waitFor(() => expect(quoteBodies).toHaveLength(1));

    act(() => {
      client.setQueryData(queryKeys.private(0, "checkout-draft"), {
        cartId: "cart-1",
        addressId: "address-home",
        promotionCodes: ["SAVE10"],
      });
    });
    await flush();

    await vi.waitFor(() => expect(quoteBodies).toHaveLength(2));
    expect(quoteBodies.at(-1)?.promotionCodes).toEqual(["SAVE10"]);

    act(() => {
      client.setQueryData(queryKeys.private(0, "checkout-draft"), {
        cartId: "cart-1",
        addressId: "address-home",
        promotionCodes: [],
      });
    });
    await vi.waitFor(() => expect(quoteBodies).toHaveLength(3));
    expect(quoteBodies.at(-1)?.promotionCodes).toEqual([]);
  });

  it("retries an unknown quote with the identical request identity", async () => {
    const requests: Array<{ key: string; body: string }> = [];
    const base = successfulFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/quote") {
          requests.push({
            key: new Headers(init?.headers).get("idempotency-key") ?? "",
            body: String(init?.body),
          });
          if (requests.length === 1)
            return Promise.reject(new Error("Response lost after submission"));
        }
        return base(url, init);
      }),
    );

    act(() => root.render(checkout()));
    await flush();
    choose(container, "Home");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.waitFor(() => expect(container.textContent).toContain("identical delivery quotation"));

    click(container, "Try quotation again");
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual(requests[0]);
    await flush();
    expect(container.textContent).not.toContain("Delivery fee confirmed with Lalamove");
  });

  it("releases a successful obsolete quote before automatically quoting newer promo intent", async () => {
    const firstQuote = deferred<Response>();
    const quoteRequests: Array<{ key: string; body: string; init?: RequestInit }> = [];
    let releases = 0;
    const base = successfulFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const path = String(url);
        if (path === "/api/checkout/quote") {
          quoteRequests.push({
            key: new Headers(init?.headers).get("idempotency-key") ?? "",
            body: String(init?.body),
            init,
          });
          if (quoteRequests.length === 1) return firstQuote.promise;
        }
        if (path.endsWith("/abandon")) releases += 1;
        return base(url, init);
      }),
    );
    const client = createQueryClient();
    act(() => root.render(checkout(client)));
    await flush();
    choose(container, "Home");
    await vi.waitFor(() => expect(quoteRequests).toHaveLength(1));

    act(() => {
      client.setQueryData(queryKeys.private(0, "checkout-draft"), {
        cartId: "cart-1",
        addressId: "address-home",
        promotionCodes: ["SAVE10"],
      });
    });
    const firstResponse = await base("/api/checkout/quote", quoteRequests[0]?.init);
    firstQuote.resolve(firstResponse);

    await vi.waitFor(() => expect(releases).toBe(1));
    await vi.waitFor(() => expect(quoteRequests).toHaveLength(2));
    expect(JSON.parse(quoteRequests[1]?.body ?? "{}").promotionCodes).toEqual(["SAVE10"]);
    expect(quoteRequests[1]?.key).not.toBe(quoteRequests[0]?.key);
  });

  it("ignores an older initial address response after a current post-save refresh", async () => {
    const initial = deferred<Response>();
    const refreshed = deferred<Response>();
    let addressCalls = 0;
    const base = successfulFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "/api/checkout/bootstrap")
          return ++addressCalls === 1 ? initial.promise : refreshed.promise;
        return base(url, init);
      }),
    );
    const client = createQueryClient();
    const accountKey = queryKeys.private(0, "account-addresses");
    client.setQueryData(accountKey, { addresses: [home], profile: { defaultAddressId: home.id } });
    act(() => root.render(checkout(client)));
    await flush();
    click(container, "Add delivery address");
    expect(addressEditorPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ multiStep: true }),
    );
    click(container, "Complete checkout address save");
    await vi.waitFor(() => expect(client.getQueryState(accountKey)?.isInvalidated).toBe(true));

    refreshed.resolve(addressesResponse([{ ...home, id: "address-new", label: "Current" }]));
    await flush();
    initial.resolve(addressesResponse([{ ...home, label: "Stale" }]));
    await flush();

    expect(container.textContent).toContain("Current");
    expect(container.textContent).not.toContain("Stale");
    await vi.waitFor(() =>
      expect(base.mock.calls.filter(([url]) => String(url) === "/api/checkout/quote")).toHaveLength(
        1,
      ),
    );
    expect(container.textContent).not.toContain("Delivery fee confirmed with Lalamove");
  });
});
