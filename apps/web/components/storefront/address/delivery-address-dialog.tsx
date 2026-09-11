"use client";

import { ChevronDown, MapPin, Pencil, X } from "lucide-react";
import Link from "next/link";
import type { CustomerAddressView, RpcResult } from "@freshmarkets/contracts";
import { useEffect, useRef, useState } from "react";
import { authClient } from "../../../lib/auth/auth-client";
import { refreshCartForLocation } from "../../../lib/storefront/cart-client";
import { usePathname, useRouter } from "next/navigation";
import {
  browsingPointFromCookies,
  DELIVERY_LOCATION_REQUEST_EVENT,
  rememberBrowsingPoint,
} from "../../../lib/storefront/browsing-location";
import { useStorefrontRuntime } from "../storefront-runtime";
import { AddressEditor, type ServiceabilitySelection } from "./address-editor";

const SESSION_SELECTION_KEY = "freshmarkets.delivery-location.v2";

type BrowsingLocation = Pick<ServiceabilitySelection, "displayAddress" | "coordinate">;

function readSelection(): BrowsingLocation | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_SELECTION_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<BrowsingLocation>;
    if (
      typeof candidate.displayAddress !== "string" ||
      !candidate.coordinate ||
      !Number.isFinite(candidate.coordinate.latitude) ||
      !Number.isFinite(candidate.coordinate.longitude)
    )
      return null;
    return { displayAddress: candidate.displayAddress, coordinate: candidate.coordinate };
  } catch {
    return null;
  }
}

function compactAddress(value: string): string {
  return value.split(",")[0]?.trim() || "Choose location";
}

export function DeliveryAddressDialog() {
  const pathname = usePathname();
  const router = useRouter();
  const { mapboxPublicAccessToken } = useStorefrontRuntime();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState({ top: 72, left: 12 });
  const [savedAddress, setSavedAddress] = useState<CustomerAddressView>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [selection, setSelection] = useState<BrowsingLocation | null>(null);

  useEffect(() => {
    // The previous keys could contain temporary provider outputs. Never migrate
    // them as confirmed data; let the customer confirm a location again.
    localStorage.removeItem("freshmarkets.delivery-location.v1");
    sessionStorage.removeItem("freshmarkets.delivery-location.v1");
    document.cookie = "freshmarkets_browse_point=; Path=/; Max-Age=0; SameSite=Lax";
    setSelection(readSelection());
    setInteractive(true);
    const browsing = pathname === "/" || pathname.startsWith("/products/") || pathname === "/cart";
    if (
      browsing &&
      !browsingPointFromCookies(document.cookie) &&
      !sessionStorage.getItem("freshmarkets.location-prompt-dismissed")
    )
      setOpen(true);
    const requestLocation = () => setOpen(true);
    window.addEventListener(DELIVERY_LOCATION_REQUEST_EVENT, requestLocation);
    return () => window.removeEventListener(DELIVERY_LOCATION_REQUEST_EVENT, requestLocation);
  }, [pathname]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 24);
      setPlacement({
        top: Math.min((rect?.bottom ?? 60) + 8, window.innerHeight - 180),
        left: Math.max(
          12,
          Math.min((rect?.right ?? width + 12) - width, window.innerWidth - width - 12),
        ),
      });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);

  function dismiss(): void {
    sessionStorage.setItem("freshmarkets.location-prompt-dismissed", "1");
    setOpen(false);
    setSavedAddress(undefined);
  }

  function chooseAddress(next: ServiceabilitySelection): void {
    const previous = browsingPointFromCookies(document.cookie);
    const browsingLocation = {
      displayAddress: next.displayAddress,
      coordinate: next.coordinate,
    };
    localStorage.setItem(SESSION_SELECTION_KEY, JSON.stringify(browsingLocation));
    rememberBrowsingPoint(next.coordinate);
    setSelection(browsingLocation);
    dismiss();
    if (
      previous?.latitude !== next.coordinate.latitude ||
      previous?.longitude !== next.coordinate.longitude
    ) {
      void refreshCartForLocation();
      router.refresh();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={!interactive}
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-2 rounded-[var(--fm-radius-control)] px-2 py-2 text-left text-xs hover:bg-[var(--fm-hover)] disabled:cursor-wait"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Choose delivery address"
      >
        <MapPin className="size-4 shrink-0 text-[var(--fm-primary-dark)]" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[10px] text-[var(--fm-text-muted)]">Deliver to</span>
          <span className="flex min-w-0 items-center gap-1 font-semibold">
            <span className="max-w-28 truncate sm:max-w-40">
              {compactAddress(selection?.displayAddress ?? "Choose location")}
            </span>
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          </span>
        </span>
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          aria-label="Choose delivery address"
          onClose={dismiss}
          onCancel={(event) => {
            event.preventDefault();
            dismiss();
          }}
          onClick={(event) => {
            if (event.target === dialogRef.current) dismiss();
          }}
          style={{
            top: placement.top,
            left: placement.left,
            maxHeight: `calc(100dvh - ${placement.top + 12}px)`,
          }}
          className="fixed m-0 w-[calc(100%-1.5rem)] max-w-[400px] overflow-visible border-0 bg-transparent p-0 shadow-none backdrop:bg-transparent"
        >
          <section
            style={{ maxHeight: `calc(100dvh - ${placement.top + 12}px)` }}
            className="max-h-[inherit] overflow-y-auto rounded-xl bg-white shadow-[var(--fm-shadow-overlay)]"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--fm-border)] bg-white px-4 py-3">
              <div>
                <h2 className="text-base font-bold">Enter your address</h2>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close delivery address"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>
            <div className="p-4">
              <AddressEditor
                key={savedAddress?.id ?? "search"}
                initialAddress={savedAddress}
                compact
                purpose="serviceability"
                publicAccessToken={mapboxPublicAccessToken}
                onServiceabilityConfirmed={chooseAddress}
              />
              <SavedDeliveryAddresses onChoose={setSavedAddress} />
              <button
                type="button"
                onClick={dismiss}
                className="mt-4 min-h-11 text-sm font-semibold underline"
              >
                Skip for now — browse groceries
              </button>
            </div>
          </section>
        </dialog>
      ) : null}
    </>
  );
}

function SavedDeliveryAddresses({
  onChoose,
}: {
  onChoose: (address: CustomerAddressView) => void;
}) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  if (!isPending && !error && session?.user)
    return <AuthenticatedSavedDeliveryAddresses key={session.user.id} onChoose={onChoose} />;
  return (
    <section aria-label="Saved addresses" className="mt-4 border-t border-[var(--fm-border)] pt-3">
      {isPending ? (
        <p role="status" className="text-sm">
          Loading saved addresses…
        </p>
      ) : error ? (
        <div role="alert" className="text-sm">
          We couldn’t load your account.{" "}
          <button type="button" className="min-h-11 underline" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <Link
          prefetch={false}
          href="/auth/login?returnTo=/account/addresses"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Sign in to see saved addresses
        </Link>
      )}
    </section>
  );
}

function AuthenticatedSavedDeliveryAddresses({
  onChoose,
}: {
  onChoose: (address: CustomerAddressView) => void;
}) {
  const [addresses, setAddresses] = useState<readonly CustomerAddressView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    async function load() {
      try {
        const response = await fetch("/api/commerce/address", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setState("guest");
          return;
        }
        const result = (await response.json()) as RpcResult<readonly CustomerAddressView[]>;
        if (controller.signal.aborted) return;
        if (!response.ok || !result.ok) {
          setState("error");
          return;
        }
        setAddresses(result.value);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return (
    <section aria-label="Saved addresses" className="mt-4 border-t border-[var(--fm-border)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Saved addresses</h3>
        <Link
          prefetch={false}
          href="/account/addresses"
          className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold"
        >
          <Pencil className="size-3" aria-hidden="true" />
          Manage
        </Link>
      </div>
      {state === "loading" && (
        <p role="status" className="text-sm">
          Loading addresses…
        </p>
      )}
      {state === "error" && (
        <div role="alert" className="text-sm">
          Addresses couldn’t be loaded.{" "}
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => setAttempt((x) => x + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {state === "guest" && (
        <Link
          prefetch={false}
          href="/auth/login?returnTo=/account/addresses"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Sign in to see saved addresses
        </Link>
      )}
      {state === "ready" && !addresses.length && (
        <p className="text-sm text-[var(--fm-text-muted)]">No saved addresses yet.</p>
      )}
      {state === "ready" &&
        addresses.map((address) => (
          <button
            key={address.id}
            type="button"
            onClick={() => onChoose(address)}
            className="flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-[var(--fm-hover)]"
          >
            <MapPin className="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold">{address.label}</span>
              <span className="text-xs text-[var(--fm-text-muted)]">
                {address.components.addressLine1}, {address.components.city}
              </span>
            </span>
          </button>
        ))}
    </section>
  );
}
