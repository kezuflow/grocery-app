// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AddressSearchCandidate,
  CustomerAddressView,
  ServiceabilityResult,
} from "@freshmarkets/contracts";
import { FakeMapAdapter } from "../../maps/fake-map-adapter";
import { AddressEditor } from "./address-editor";

const candidate: AddressSearchCandidate = {
  candidateKey: "opaque-candidate-key",
  displayAddress: "Ayala Center Cebu, Cebu City 6000, Philippines",
  coordinate: { latitude: 10.3173, longitude: 123.9058 },
  components: {
    addressLine1: "Ayala Center Cebu",
    addressLine2: null,
    barangay: "Luz",
    city: "Cebu City",
    region: "Central Visayas",
    postalCode: "6000",
    countryCode: "PH",
  },
  accuracy: "rooftop",
};

const serviceable: ServiceabilityResult = {
  serviceable: true,
  reason: null,
  coordinate: candidate.coordinate,
  market: {
    code: "METRO_CEBU",
    name: "Metro Cebu",
    currency: "PHP",
    timezone: "Asia/Manila",
  },
  serviceArea: { code: "CEBU_CITY", name: "Cebu City", polygonVersion: 1 },
  deliveryZone: { code: "CEBU_CITY_CORE", name: "Cebu City Core", polygonVersion: 1 },
  fulfillmentEligibility: { eligible: true, candidateCount: 1 },
  resolutionChanged: false,
  evaluatedAt: "2026-08-30T00:00:00.000Z",
};

const savedAddress: CustomerAddressView = {
  id: "address-saved",
  label: "Home",
  recipient: "Ana Santos",
  phone: "+639171234567",
  components: candidate.components,
  confirmationSource: "GEOCODER",
  confirmedAt: "2026-08-30T00:00:00.000Z",
  instructions: {
    buildingUnit: "Unit 4",
    landmark: null,
    gateGuard: null,
    deliveryNote: null,
    recipientInstruction: null,
  },
  latitude: candidate.coordinate.latitude,
  longitude: candidate.coordinate.longitude,
  serviceable: true,
  serviceabilityReason: null,
  serviceAreaCode: "CEBU_CITY",
  deliveryZoneCode: "CEBU_CITY_CORE",
  resolutionVersion: 1,
  status: "active",
  version: 3,
};

type Mounted = { container: HTMLDivElement; root: Root };

function mount(
  properties: Partial<React.ComponentProps<typeof AddressEditor>> & {
    fetchImpl: typeof fetch;
  },
): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <AddressEditor
        publicAccessToken="public-token"
        onConfirmed={vi.fn()}
        mapAdapter={new FakeMapAdapter()}
        {...properties}
      />,
    );
  });
  return { container, root };
}

function input(container: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const found = labels.find((element) => element.textContent?.includes(label));
  const control = found?.control;
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement))
    throw new Error(`Missing control for ${label}`);
  return control;
}

function change(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      control instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(element: Element): void {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function selectCandidate(container: HTMLElement, fetchImpl: ReturnType<typeof vi.fn>) {
  change(input(container, "Search for an address"), "Ayala Cebu");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await flush();
  const option = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(candidate.displayAddress),
  );
  if (!option) throw new Error("Candidate option was not rendered");
  click(option);
  await flush();
  expect(fetchImpl).toHaveBeenCalled();
}

describe("AddressEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("debounces search and aborts the stale request when the query changes", async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((response: Response) => void) | undefined;
    let fetchCount = 0;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        firstSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(response({ ok: true, value: [candidate], requestId: "search-2" }));
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const { container, root } = mount({ fetchImpl });
    const search = input(container, "Search for an address");

    change(search, "Aya");
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(fetchImpl).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    change(search, "Ayala Cebu");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await flush();

    expect(firstSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/commerce/address-search");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      query: "Ayala Cebu",
    });
    expect(container.textContent).toContain(candidate.displayAddress);

    resolveFirst?.(
      response({
        ok: true,
        value: [{ ...candidate, displayAddress: "Stale private result" }],
        requestId: "search-1",
      }),
    );
    await flush();
    expect(container.textContent).not.toContain("Stale private result");
    expect(container.textContent).toContain(candidate.displayAddress);
    act(() => root.unmount());
  });

  it("selects a candidate, moves the exact pin, and refreshes serviceability", async () => {
    const moved = { latitude: 10.319, longitude: 123.907 };
    let savedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.startsWith("/api/commerce/address-search"))
        return Promise.resolve(response({ ok: true, value: [candidate], requestId: "search" }));
      if (path === "/api/serviceability")
        return Promise.resolve(
          response({ ok: true, value: { ...serviceable, coordinate: moved }, requestId: "svc" }),
        );
      if (path === "/api/commerce/address") {
        savedBody = JSON.parse(String(init?.body));
        return Promise.resolve(
          response({ ok: true, value: { id: "address-pin" }, requestId: "save" }),
        );
      }
      throw new Error(`Unexpected request ${path}`);
    }) as unknown as typeof fetch;
    const adapter = new FakeMapAdapter();
    const { container, root } = mount({ fetchImpl, mapAdapter: adapter });

    await selectCandidate(container, fetchImpl as ReturnType<typeof vi.fn>);
    expect(adapter.initializations.at(-1)?.scene.draggablePin?.position).toEqual(
      candidate.coordinate,
    );

    act(() => adapter.emitPinMove({ longitude: moved.longitude, latitude: moved.latitude }));
    await flush();
    const serviceabilityCall = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => String(url) === "/api/serviceability")
      .at(-1);
    expect(JSON.parse(String(serviceabilityCall?.[1]?.body))).toMatchObject(moved);
    expect(container.textContent).toContain("Delivery is available");
    change(input(container, "Address label"), "Home");
    change(input(container, "Recipient name"), "Ana Santos");
    change(input(container, "Phone number"), "+639171234567");
    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save confirmed address"),
    );
    if (!save) throw new Error("Missing save action");
    click(save);
    await flush();
    expect(savedBody).toMatchObject({ ...moved, confirmationSource: "USER_PIN" });
    act(() => root.unmount());
  });

  it("distinguishes provider-resolved address fields from editable delivery details", async () => {
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      const path = String(url);
      if (path === "/api/commerce/address-search")
        return Promise.resolve(response({ ok: true, value: [candidate], requestId: "search" }));
      if (path === "/api/serviceability")
        return Promise.resolve(response({ ok: true, value: serviceable, requestId: "svc" }));
      throw new Error(`Unexpected request ${path}`);
    }) as unknown as typeof fetch;
    const adapter = new FakeMapAdapter();
    const { container, root } = mount({ fetchImpl, mapAdapter: adapter });
    await selectCandidate(container, fetchImpl as ReturnType<typeof vi.fn>);

    expect(container.textContent).toContain(
      "Search-result address fields are provider-resolved when saved",
    );
    expect(input(container, "Street, building, or place")).toHaveProperty("readOnly", true);
    expect(input(container, "Building or unit")).toHaveProperty("readOnly", false);

    act(() => adapter.emitPinMove({ latitude: 10.319, longitude: 123.907 }));
    await flush();
    expect(input(container, "Street, building, or place")).toHaveProperty("readOnly", false);
    act(() => root.unmount());
  });

  it("ignores an older serviceability response that resolves after the current pin", async () => {
    const serviceabilityResolvers: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      const path = String(url);
      if (path === "/api/commerce/address-search")
        return Promise.resolve(response({ ok: true, value: [candidate], requestId: "search" }));
      if (path === "/api/serviceability")
        return new Promise<Response>((resolve) => serviceabilityResolvers.push(resolve));
      throw new Error(`Unexpected request ${path}`);
    }) as unknown as typeof fetch;
    const adapter = new FakeMapAdapter();
    const { container, root } = mount({ fetchImpl, mapAdapter: adapter });
    await selectCandidate(container, fetchImpl as ReturnType<typeof vi.fn>);
    act(() => adapter.emitPinMove({ latitude: 10.319, longitude: 123.907 }));

    serviceabilityResolvers[1]?.(
      response({ ok: true, value: serviceable, requestId: "serviceability-current" }),
    );
    await flush();
    expect(container.textContent).toContain("Delivery is available");

    serviceabilityResolvers[0]?.(
      response({
        ok: true,
        value: {
          ...serviceable,
          serviceable: false,
          reason: "OUTSIDE_SERVICE_AREA",
          fulfillmentEligibility: { eligible: false, candidateCount: 0 },
        },
        requestId: "serviceability-stale",
      }),
    );
    await flush();

    expect(container.textContent).toContain("Delivery is available");
    expect(container.textContent).not.toContain("Delivery is unavailable");
    act(() => root.unmount());
  });

  it("uses device location on success and provides safe recovery on denial", async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success({ coords: { latitude: 10.31, longitude: 123.89 } } as GeolocationPosition),
      ),
    } as unknown as Geolocation;
    const fetchImpl = vi.fn(() =>
      Promise.resolve(response({ ok: true, value: serviceable, requestId: "svc" })),
    ) as unknown as typeof fetch;
    const { container, root } = mount({ fetchImpl, geolocation });
    const locate = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use current location"),
    );
    if (!locate) throw new Error("Missing current-location action");
    click(locate);
    await flush();
    expect(container.textContent).toContain("Current location selected");
    act(() => root.unmount());

    const denied = {
      getCurrentPosition: vi.fn((_success: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1, message: "private browser detail" } as GeolocationPositionError),
      ),
    } as unknown as Geolocation;
    const deniedMount = mount({ fetchImpl, geolocation: denied });
    const deniedAction = Array.from(deniedMount.container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Use current location"),
    );
    if (!deniedAction) throw new Error("Missing current-location action");
    click(deniedAction);
    expect(deniedMount.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Location permission was not granted",
    );
    expect(deniedMount.container.textContent).not.toContain("private browser detail");
    act(() => deniedMount.root.unmount());
  });

  it("ignores delayed geolocation callbacks after a newer candidate selection", async () => {
    let delayedSuccess: PositionCallback | undefined;
    let delayedFailure: PositionErrorCallback | undefined;
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
        delayedSuccess = success;
        delayedFailure = failure;
      }),
    } as unknown as Geolocation;
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      const path = String(url);
      if (path === "/api/commerce/address-search")
        return Promise.resolve(response({ ok: true, value: [candidate], requestId: "search" }));
      if (path === "/api/serviceability")
        return Promise.resolve(response({ ok: true, value: serviceable, requestId: "svc" }));
      throw new Error(`Unexpected request ${path}`);
    }) as unknown as typeof fetch;
    const adapter = new FakeMapAdapter();
    const { container, root } = mount({ fetchImpl, geolocation, mapAdapter: adapter });
    const locate = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use current location"),
    );
    if (!locate) throw new Error("Missing current-location action");
    click(locate);
    await selectCandidate(container, fetchImpl as ReturnType<typeof vi.fn>);

    act(() => {
      delayedSuccess?.({
        coords: { latitude: 10.4, longitude: 123.8 },
      } as GeolocationPosition);
      delayedFailure?.({ code: 1, message: "private browser detail" } as GeolocationPositionError);
    });
    await flush();

    expect(container.textContent).toContain(`Selected address: ${candidate.displayAddress}`);
    expect(container.textContent).not.toContain("Current location selected");
    expect(container.textContent).not.toContain("Location permission was not granted");
    expect(adapter.initializations.at(-1)?.scene.draggablePin?.position).toEqual(
      candidate.coordinate,
    );
    act(() => root.unmount());
  });

  it("submits structured instructions and confirms an unavailable saved address", async () => {
    const unavailable = {
      ...serviceable,
      serviceable: false,
      reason: "OUTSIDE_SERVICE_AREA" as const,
      serviceArea: null,
      deliveryZone: null,
      fulfillmentEligibility: { eligible: false, candidateCount: 0 },
    };
    let savedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.startsWith("/api/commerce/address-search"))
        return Promise.resolve(response({ ok: true, value: [candidate], requestId: "search" }));
      if (path === "/api/serviceability")
        return Promise.resolve(response({ ok: true, value: unavailable, requestId: "svc" }));
      if (path === "/api/commerce/address") {
        savedBody = JSON.parse(String(init?.body));
        return Promise.resolve(
          response({ ok: true, value: { id: "address-unavailable" }, requestId: "save" }),
        );
      }
      throw new Error(`Unexpected request ${path}`);
    }) as unknown as typeof fetch;
    const onConfirmed = vi.fn();
    const { container, root } = mount({ fetchImpl, onConfirmed });
    await selectCandidate(container, fetchImpl as ReturnType<typeof vi.fn>);

    change(input(container, "Address label"), "Home");
    change(input(container, "Recipient name"), "Ana Santos");
    change(input(container, "Phone number"), "+639171234567");
    change(input(container, "Building or unit"), "Unit 4");
    change(input(container, "Landmark"), "Main entrance");
    change(input(container, "Gate or guard instructions"), "Leave ID with guard");
    change(input(container, "Delivery note"), "Call on arrival");
    change(input(container, "Recipient guidance"), "Ask for Ana");
    await flush();
    expect(container.textContent).toContain("Delivery is unavailable");

    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save unavailable address"),
    );
    if (!save) throw new Error("Missing unavailable save action");
    click(save);
    await flush();

    expect(savedBody).toMatchObject({
      label: "Home",
      recipient: "Ana Santos",
      phone: "+639171234567",
      components: candidate.components,
      latitude: candidate.coordinate.latitude,
      longitude: candidate.coordinate.longitude,
      confirmationSource: "GEOCODER",
      instructions: {
        buildingUnit: "Unit 4",
        landmark: "Main entrance",
        gateGuard: "Leave ID with guard",
        deliveryNote: "Call on arrival",
        recipientInstruction: "Ask for Ana",
      },
    });
    expect(savedBody).not.toHaveProperty("candidateKey");
    expect(onConfirmed).toHaveBeenCalledWith("address-unavailable");
    act(() => root.unmount());
  });

  it("does not clear an existing note that the address read model did not load", async () => {
    let updateBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      updateBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        response({ ok: true, value: { id: savedAddress.id }, requestId: "update" }),
      );
    }) as unknown as typeof fetch;
    const { container, root } = mount({ fetchImpl, initialAddress: savedAddress });

    expect(container.textContent).not.toContain("Private address note");
    const update = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Update confirmed address"),
    );
    if (!update) throw new Error("Missing update action");
    click(update);
    await flush();

    expect(updateBody).not.toHaveProperty("notes");
    expect(updateBody).toMatchObject({ addressId: savedAddress.id, expectedVersion: 3 });
    act(() => root.unmount());
  });

  it("renders safe provider errors and a coordinate-free textual map fallback", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        response(
          {
            ok: false,
            error: {
              code: "GEOCODER_UNAVAILABLE",
              message: "provider secret detail",
              requestId: "search-error",
            },
          },
          503,
        ),
      ),
    ) as unknown as typeof fetch;
    const adapter = new FakeMapAdapter({ initializationError: new Error("private map detail") });
    const { container, root } = mount({ fetchImpl, mapAdapter: adapter });
    change(input(container, "Search for an address"), "Ayala Cebu");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Address search is temporarily unavailable",
    );
    expect(container.textContent).not.toContain("provider secret detail");
    expect(container.textContent).toContain(
      "You can still choose a search result or use your current location",
    );
    expect(container.querySelector('input[name="latitude"]')).toBeNull();
    expect(container.querySelector('input[name="longitude"]')).toBeNull();
    expect(container.textContent).not.toContain("private map detail");
    act(() => root.unmount());
  });
});
