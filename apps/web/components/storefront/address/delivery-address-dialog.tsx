"use client";

import { ChevronDown, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStorefrontRuntime } from "../storefront-runtime";
import { AddressEditor, type ServiceabilitySelection } from "./address-editor";

const SESSION_SELECTION_KEY = "freshmarkets.delivery-location.v1";

type BrowsingLocation = Pick<ServiceabilitySelection, "displayAddress" | "coordinate">;

function readSelection(): BrowsingLocation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_SELECTION_KEY) ?? "null") as unknown;
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
  return value.split(",")[0]?.trim() || "Cebu City";
}

export function DeliveryAddressDialog() {
  const { mapboxPublicAccessToken } = useStorefrontRuntime();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [selection, setSelection] = useState<BrowsingLocation | null>(null);

  useEffect(() => {
    setSelection(readSelection());
    setInteractive(true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function chooseAddress(next: ServiceabilitySelection): void {
    const browsingLocation = {
      displayAddress: next.displayAddress,
      coordinate: next.coordinate,
    };
    sessionStorage.setItem(SESSION_SELECTION_KEY, JSON.stringify(browsingLocation));
    setSelection(browsingLocation);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        disabled={!interactive}
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-2 rounded-[var(--fm-radius-control)] px-2 py-2 text-left text-xs hover:bg-[var(--fm-hover)] disabled:cursor-wait"
        aria-haspopup="dialog"
        aria-label="Choose delivery address"
      >
        <MapPin className="size-4 shrink-0 text-[var(--fm-primary-dark)]" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[10px] text-[var(--fm-text-muted)]">Deliver to</span>
          <span className="flex min-w-0 items-center gap-1 font-semibold">
            <span className="max-w-28 truncate sm:max-w-40">
              {compactAddress(selection?.displayAddress ?? "Cebu City")}
            </span>
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          </span>
        </span>
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          aria-label="Choose delivery address"
          onClose={() => setOpen(false)}
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onClick={(event) => {
            if (event.target === dialogRef.current) setOpen(false);
          }}
          className="m-auto w-[calc(100%-1.5rem)] max-w-4xl overflow-visible bg-transparent p-0 shadow-none backdrop:bg-black/45"
        >
          <section className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl bg-white shadow-[var(--fm-shadow-overlay)]">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--fm-border)] bg-white px-5 py-4 sm:px-6">
              <div>
                <h1 className="text-xl font-bold tracking-[-0.02em]">Choose a delivery address</h1>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Search, place the pin at the exact entrance, then confirm delivery coverage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close delivery address"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>
            <div className="p-5 sm:p-6">
              <AddressEditor
                purpose="serviceability"
                publicAccessToken={mapboxPublicAccessToken}
                onServiceabilityConfirmed={chooseAddress}
              />
            </div>
          </section>
        </dialog>
      ) : null}
    </>
  );
}
