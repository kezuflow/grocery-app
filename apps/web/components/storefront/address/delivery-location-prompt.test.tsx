// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeliveryLocationPrompt } from "./delivery-location-prompt";
import {
  BROWSING_LOCATION_COOKIE,
  DELIVERY_LOCATION_REQUEST_EVENT,
  rememberDeliveryLocationSelection,
} from "../../../lib/storefront/browsing-location";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  route.pathname = "/";
  localStorage.clear();
  document.cookie = `${BROWSING_LOCATION_COOKIE}=; Path=/; Max-Age=0`;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

it("invites a first visitor to choose a location and disappears after confirmation", async () => {
  const requestLocation = vi.fn();
  window.addEventListener(DELIVERY_LOCATION_REQUEST_EVENT, requestLocation);
  await act(async () => root.render(<DeliveryLocationPrompt />));
  expect(
    document.querySelector('[role="region"][aria-label="Choose delivery location"]'),
  ).not.toBeNull();
  const action = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Set delivery location"),
  );
  expect(action).toBeDefined();
  act(() => action?.click());
  expect(requestLocation).toHaveBeenCalledTimes(1);
  act(() =>
    rememberDeliveryLocationSelection({
      displayAddress: "Test location",
      coordinate: { latitude: 10, longitude: 123 },
      savedAddressId: null,
    }),
  );
  expect(
    document.querySelector('[role="region"][aria-label="Choose delivery location"]'),
  ).toBeNull();
  window.removeEventListener(DELIVERY_LOCATION_REQUEST_EVENT, requestLocation);
});
