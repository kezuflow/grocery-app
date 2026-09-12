"use client";

import { AlertTriangle, Check, MapPin, PencilLine } from "lucide-react";
import type { CustomerAddressView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";

export type AddressListProps = Readonly<{
  addresses: ReadonlyArray<CustomerAddressView>;
  selectedAddressId?: string;
  onSelect: (addressId: string) => void;
  onCorrect: (address: CustomerAddressView) => void;
  defaultAddressId?: string | null;
  onManage?: (action: "SET_DEFAULT" | "REMOVE", address: CustomerAddressView) => void;
}>;

function displayAddress(address: CustomerAddressView): string {
  return [
    address.components.addressLine1,
    address.components.addressLine2,
    address.components.barangay,
    address.components.city,
    address.components.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function AddressList({
  addresses,
  selectedAddressId,
  onSelect,
  onCorrect,
  defaultAddressId,
  onManage,
}: AddressListProps) {
  if (addresses.length === 0)
    return (
      <div
        role="status"
        className="rounded-[var(--fm-radius-surface)] border border-dashed border-[var(--fm-border)] bg-[var(--fm-surface-soft)] p-5"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[var(--fm-primary-dark)] shadow-sm">
            <MapPin className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-[var(--fm-text)]">No saved delivery addresses yet</p>
            <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
              Add an address and confirm its exact entrance to continue.
            </p>
          </div>
        </div>
      </div>
    );

  return (
    <div
      role="radiogroup"
      aria-label="Saved delivery addresses"
      className="grid gap-3 sm:grid-cols-2"
    >
      {addresses.map((address) => {
        const available = address.confirmedAt !== null;
        const selected = selectedAddressId === address.id;
        const choiceId = `address-choice-${address.id}`;
        const descriptionId = `${choiceId}-description`;
        return (
          <div
            key={address.id}
            className={cn(
              "relative rounded-[var(--fm-radius-surface)] border bg-white p-4 transition-[border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              selected
                ? "border-[var(--fm-primary-dark)] bg-[var(--fm-hover)] shadow-[var(--fm-shadow-card)]"
                : "border-[var(--fm-border)]",
              !available && "bg-[var(--fm-surface-soft)]",
            )}
          >
            <label
              htmlFor={choiceId}
              className={cn(
                "flex items-start gap-3",
                available ? "cursor-pointer" : "cursor-not-allowed",
              )}
            >
              <input
                id={choiceId}
                type="radio"
                name="saved-address"
                value={address.id}
                disabled={!available}
                checked={selectedAddressId === address.id}
                aria-describedby={descriptionId}
                onChange={() => onSelect(address.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border",
                  selected
                    ? "border-[var(--fm-primary-dark)] bg-[var(--fm-primary-dark)] text-white"
                    : available
                      ? "border-[var(--fm-border)] bg-white text-[var(--fm-primary-dark)]"
                      : "border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] text-amber-800",
                )}
              >
                {selected ? (
                  <Check className="size-4" />
                ) : available ? (
                  <MapPin className="size-4" />
                ) : (
                  <AlertTriangle className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-[var(--fm-text)]">
                  {address.label}
                  {address.id === defaultAddressId ? (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fm-text-muted)]">
                      Default
                    </span>
                  ) : null}
                </span>
                <span
                  id={descriptionId}
                  className="mt-1.5 block text-sm leading-5 text-[var(--fm-text-muted)]"
                >
                  {displayAddress(address)}
                </span>
                <span className="mt-2 block text-xs text-[var(--fm-text-muted)]">
                  {address.recipient} · {address.phone}
                </span>
                <span
                  role="status"
                  className={cn(
                    "mt-3 inline-flex items-center gap-1.5 text-xs font-semibold",
                    available ? "text-[var(--fm-success)]" : "text-amber-800",
                  )}
                >
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {available ? "Courier checked at checkout" : "Address confirmation required"}
                </span>
              </span>
            </label>
            <button
              type="button"
              aria-label={`${available ? "Edit" : "Confirm"} ${address.label} address`}
              onClick={() => onCorrect(address)}
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm font-semibold transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              <PencilLine className="size-3.5" aria-hidden="true" />
              {available ? "Edit address" : "Confirm address"}
            </button>
            {onManage ? (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {address.id !== defaultAddressId ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onManage("SET_DEFAULT", address)}
                    aria-label={`Use ${address.label} as default`}
                  >
                    Use as default
                  </button>
                ) : null}
                <button
                  type="button"
                  className="underline"
                  onClick={() => onManage("REMOVE", address)}
                  aria-label={`Remove ${address.label} address`}
                >
                  Remove address
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
