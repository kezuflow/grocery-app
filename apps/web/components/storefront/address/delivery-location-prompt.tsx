"use client";

import { ArrowRight, MapPin } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  browsingPointFromCookies,
  DELIVERY_LOCATION_CHANGED_EVENT,
  DELIVERY_LOCATION_REQUEST_EVENT,
} from "../../../lib/storefront/browsing-location";

export function DeliveryLocationPrompt() {
  const pathname = usePathname();
  const [needsLocation, setNeedsLocation] = useState(false);
  const browsing = pathname === "/" || pathname.startsWith("/products/") || pathname === "/cart";

  useEffect(() => {
    const refresh = () => setNeedsLocation(!browsingPointFromCookies(document.cookie));
    refresh();
    window.addEventListener(DELIVERY_LOCATION_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(DELIVERY_LOCATION_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);

  if (!browsing || !needsLocation) return null;

  return (
    <div
      role="region"
      aria-label="Choose delivery location"
      className="border-b border-[var(--fm-storefront-action)] bg-[var(--fm-success-soft)]"
    >
      <div className="mx-auto flex max-w-[var(--fm-container-content)] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-start gap-3 sm:flex-1">
          <MapPin
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-[var(--fm-storefront-action)]"
          />
          <div>
            <p className="text-sm font-semibold text-[var(--fm-text)]">Where should we deliver?</p>
            <p className="text-sm text-[var(--fm-text-muted)]">
              Set your location to see prices and availability in your area.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(DELIVERY_LOCATION_REQUEST_EVENT))}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] px-4 text-sm font-semibold text-white hover:bg-[var(--fm-storefront-action-hover)] sm:w-auto"
        >
          Set delivery location
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
