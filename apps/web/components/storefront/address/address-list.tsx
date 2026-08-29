"use client";

import type { CustomerAddressView } from "@freshmarkets/contracts";

export type AddressListProps = Readonly<{
  addresses: ReadonlyArray<CustomerAddressView>;
  selectedAddressId?: string;
  onSelect: (addressId: string) => void;
  onCorrect: (address: CustomerAddressView) => void;
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
}: AddressListProps) {
  if (addresses.length === 0)
    return (
      <div role="status" className="rounded-xl border border-dashed border-slate-300 p-5">
        <p className="font-medium text-slate-900">No saved delivery addresses yet</p>
        <p className="mt-1 text-sm text-slate-600">Add and confirm an address to continue.</p>
      </div>
    );

  return (
    <div role="radiogroup" aria-label="Saved delivery addresses" className="space-y-3">
      {addresses.map((address) => {
        const available = address.serviceable === true;
        const choiceId = `address-choice-${address.id}`;
        const descriptionId = `${choiceId}-description`;
        return (
          <div key={address.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <label htmlFor={choiceId} className="flex cursor-pointer items-start gap-3">
              <input
                id={choiceId}
                type="radio"
                name="saved-address"
                value={address.id}
                disabled={!available}
                checked={selectedAddressId === address.id}
                aria-describedby={descriptionId}
                onChange={() => onSelect(address.id)}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-slate-950">
                  {address.label}
                  <span
                    role="status"
                    className={
                      available
                        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"
                        : "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                    }
                  >
                    {available ? "Delivery available" : "Delivery unavailable"}
                  </span>
                </span>
                <span id={descriptionId} className="mt-1 block text-sm text-slate-600">
                  {displayAddress(address)} · {address.recipient} · {address.phone}
                </span>
              </span>
            </label>
            {!available ? (
              <button
                type="button"
                aria-label={`Correct ${address.label} address`}
                onClick={() => onCorrect(address)}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
              >
                Correct address
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
