"use client";

import type { PaymentMethodToken } from "@freshmarkets/contracts";

type Method = Readonly<{
  value: string;
  label: string;
  logoSrc: string;
  available: boolean;
}>;

const methods: readonly Method[] = [
  {
    value: "qrph",
    label: "QR Ph",
    logoSrc: "/payment-methods/qr-ph.svg",
    available: true,
  },
  {
    value: "gcash",
    label: "GCash",
    logoSrc: "/payment-methods/gcash.svg",
    available: false,
  },
  {
    value: "paymaya",
    label: "Maya",
    logoSrc: "/payment-methods/maya.svg",
    available: false,
  },
  {
    value: "grab_pay",
    label: "GrabPay",
    logoSrc: "/payment-methods/grabpay.svg",
    available: false,
  },
  {
    value: "shopeepay",
    label: "ShopeePay",
    logoSrc: "/payment-methods/shopeepay.svg",
    available: false,
  },
  {
    value: "card",
    label: "Visa & Mastercard",
    logoSrc: "/payment-methods/visa-mastercard.svg",
    available: false,
  },
  {
    value: "google_pay",
    label: "Google Pay",
    logoSrc: "/payment-methods/google-pay.svg",
    available: false,
  },
  {
    value: "bdo",
    label: "BDO",
    logoSrc: "/payment-methods/bdo.svg",
    available: false,
  },
  {
    value: "bpi",
    label: "BPI",
    logoSrc: "/payment-methods/bpi.svg",
    available: false,
  },
  {
    value: "landbank",
    label: "Landbank",
    logoSrc: "/payment-methods/landbank.svg",
    available: false,
  },
  {
    value: "metrobank",
    label: "Metrobank",
    logoSrc: "/payment-methods/metrobank.svg",
    available: false,
  },
  {
    value: "rcbc",
    label: "RCBC",
    logoSrc: "/payment-methods/rcbc.svg",
    available: false,
  },
  {
    value: "ubp",
    label: "UnionBank",
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
      className="mt-4 divide-y divide-[var(--fm-border)] border-y border-[var(--fm-border)]"
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
            className={`flex min-h-20 w-full items-center gap-4 px-3 py-3 text-left transition-[background-color,color,opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fm-primary-dark)] active:scale-[0.99] disabled:cursor-not-allowed disabled:active:scale-100 ${
              checked ? "bg-[var(--fm-hover)] text-[var(--fm-primary-dark)]" : "bg-white"
            } disabled:text-slate-400 disabled:opacity-65`}
          >
            <span
              aria-hidden="true"
              data-state={checked ? "checked" : "unchecked"}
              className={`grid size-5 shrink-0 place-items-center rounded-full border ${
                checked
                  ? "border-[var(--fm-primary-dark)] bg-[var(--fm-primary-dark)]"
                  : method.available
                    ? "border-[var(--fm-primary-dark)] bg-white"
                    : "border-slate-300 bg-white"
              }`}
            >
              <span
                className={`size-2 rounded-full bg-white ${checked ? "opacity-100" : "opacity-0"}`}
              />
            </span>
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white p-1.5">
              <img
                src={method.logoSrc}
                alt=""
                aria-hidden="true"
                width={40}
                height={40}
                className={`size-9 object-contain ${method.available ? "" : "opacity-65"}`}
              />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-current">
              {method.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
