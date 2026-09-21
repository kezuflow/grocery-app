"use client";

import type { PaymentMethodToken } from "@freshmarkets/contracts";

type Method = Readonly<{
  value: string;
  label: string;
  description: string;
  logoSrc: string;
  available: boolean;
}>;

const methods: readonly Method[] = [
  {
    value: "qrph",
    label: "QR Ph",
    description: "Scan with GCash, Maya, or a participating bank app.",
    logoSrc: "/payment-methods/qr-ph.svg",
    available: true,
  },
  {
    value: "gcash",
    label: "GCash",
    description: "E-wallet",
    logoSrc: "/payment-methods/gcash.svg",
    available: false,
  },
  {
    value: "paymaya",
    label: "Maya",
    description: "E-wallet",
    logoSrc: "/payment-methods/maya.svg",
    available: false,
  },
  {
    value: "grab_pay",
    label: "GrabPay",
    description: "E-wallet",
    logoSrc: "/payment-methods/grabpay.svg",
    available: false,
  },
  {
    value: "shopeepay",
    label: "ShopeePay",
    description: "E-wallet",
    logoSrc: "/payment-methods/shopeepay.svg",
    available: false,
  },
  {
    value: "card",
    label: "Visa & Mastercard",
    description: "Card",
    logoSrc: "/payment-methods/visa-mastercard.svg",
    available: false,
  },
  {
    value: "google_pay",
    label: "Google Pay",
    description: "Digital wallet",
    logoSrc: "/payment-methods/google-pay.svg",
    available: false,
  },
  {
    value: "bdo",
    label: "BDO",
    description: "Direct debit",
    logoSrc: "/payment-methods/bdo.svg",
    available: false,
  },
  {
    value: "bpi",
    label: "BPI",
    description: "Direct debit",
    logoSrc: "/payment-methods/bpi.svg",
    available: false,
  },
  {
    value: "landbank",
    label: "Landbank",
    description: "Direct debit",
    logoSrc: "/payment-methods/landbank.svg",
    available: false,
  },
  {
    value: "metrobank",
    label: "Metrobank",
    description: "Direct debit",
    logoSrc: "/payment-methods/metrobank.svg",
    available: false,
  },
  {
    value: "rcbc",
    label: "RCBC",
    description: "Direct debit",
    logoSrc: "/payment-methods/rcbc.svg",
    available: false,
  },
  {
    value: "ubp",
    label: "UnionBank",
    description: "Direct debit",
    logoSrc: "/payment-methods/unionbank.svg",
    available: false,
  },
] as const;

export function PaymentMethodPicker({
  selected,
  onSelect,
}: {
  selected: PaymentMethodToken | null;
  onSelect: (method: PaymentMethodToken) => void;
}) {
  return (
    <div
      className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3"
      role="radiogroup"
      aria-label="Payment method"
    >
      {methods.map((method) => {
        const checked = selected?.value === method.value;
        return (
          <button
            key={method.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={!method.available}
            disabled={!method.available}
            onClick={() => onSelect({ kind: "TOKEN", value: method.value })}
            className={`flex min-h-24 items-center gap-3 rounded-[var(--fm-radius-surface)] border p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fm-primary-dark)] active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${
              checked
                ? "border-[var(--fm-primary-dark)] bg-[var(--fm-hover)] shadow-[var(--fm-shadow-card)]"
                : "border-[var(--fm-border)] bg-white"
            } disabled:bg-[var(--fm-surface-soft)] disabled:text-slate-400`}
          >
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--fm-border)] bg-white p-1">
              <img
                src={method.logoSrc}
                alt=""
                aria-hidden="true"
                width={40}
                height={40}
                className={`size-9 object-contain ${method.available ? "" : "opacity-65"}`}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5 text-current">
                {method.label}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--fm-text-muted)]">
                {method.description}
              </span>
              <span
                className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  method.available
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {method.available ? (checked ? "Selected" : "Available") : "Not active"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
