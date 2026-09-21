"use client";

import { useState } from "react";
import type { PaymentMethodToken } from "@freshmarkets/contracts";

type CategoryId = "cash-on-delivery" | "wallet" | "card" | "online-banking";

type Method = Readonly<{
  value: string;
  label: string;
  logoSrc: string;
  available: boolean;
  category: Exclude<CategoryId, "cash-on-delivery">;
}>;

const categories: ReadonlyArray<Readonly<{ id: CategoryId; label: string; disabled?: boolean }>> = [
  { id: "cash-on-delivery", label: "Cash on Delivery", disabled: true },
  { id: "wallet", label: "Payment / E-Wallet" },
  { id: "card", label: "Credit / Debit Card" },
  { id: "online-banking", label: "Online Banking" },
];

const methods: readonly Method[] = [
  {
    value: "qrph",
    label: "QR Ph",
    logoSrc: "/payment-methods/qr-ph.svg",
    available: true,
    category: "wallet",
  },
  {
    value: "gcash",
    label: "GCash",
    logoSrc: "/payment-methods/gcash.svg",
    available: false,
    category: "wallet",
  },
  {
    value: "paymaya",
    label: "Maya",
    logoSrc: "/payment-methods/maya.svg",
    available: false,
    category: "wallet",
  },
  {
    value: "grab_pay",
    label: "GrabPay",
    logoSrc: "/payment-methods/grabpay.svg",
    available: false,
    category: "wallet",
  },
  {
    value: "shopeepay",
    label: "ShopeePay",
    logoSrc: "/payment-methods/shopeepay.svg",
    available: false,
    category: "wallet",
  },
  {
    value: "card",
    label: "Visa & Mastercard",
    logoSrc: "/payment-methods/visa-mastercard.svg",
    available: false,
    category: "card",
  },
  {
    value: "google_pay",
    label: "Google Pay",
    logoSrc: "/payment-methods/google-pay.svg",
    available: false,
    category: "wallet",
  },
  {
    value: "bdo",
    label: "BDO",
    logoSrc: "/payment-methods/bdo.svg",
    available: false,
    category: "online-banking",
  },
  {
    value: "bpi",
    label: "BPI",
    logoSrc: "/payment-methods/bpi.svg",
    available: false,
    category: "online-banking",
  },
  {
    value: "landbank",
    label: "Landbank",
    logoSrc: "/payment-methods/landbank.svg",
    available: false,
    category: "online-banking",
  },
  {
    value: "metrobank",
    label: "Metrobank",
    logoSrc: "/payment-methods/metrobank.svg",
    available: false,
    category: "online-banking",
  },
  {
    value: "rcbc",
    label: "RCBC",
    logoSrc: "/payment-methods/rcbc.svg",
    available: false,
    category: "online-banking",
  },
  {
    value: "ubp",
    label: "UnionBank",
    logoSrc: "/payment-methods/unionbank.svg",
    available: false,
    category: "online-banking",
  },
] as const;

function categoryFor(value: string | undefined): Exclude<CategoryId, "cash-on-delivery"> | null {
  return methods.find((method) => method.value === value)?.category ?? null;
}

export function PaymentMethodPicker({
  selected,
  onSelect,
}: {
  selected: PaymentMethodToken | null;
  onSelect: (method: PaymentMethodToken) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>(
    () => categoryFor(selected?.value) ?? "wallet",
  );
  const visibleMethods = methods.filter((method) => method.category === activeCategory);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Payment method category">
        {categories.map((category) => {
          const active = activeCategory === category.id;
          return (
            <button
              key={category.id}
              id={`payment-category-${category.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="payment-method-options"
              aria-disabled={category.disabled}
              disabled={category.disabled}
              onClick={() => setActiveCategory(category.id)}
              className={`min-h-10 rounded-[var(--fm-radius-control)] border px-3 py-2 text-sm font-semibold transition-[border-color,background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fm-primary-dark)] active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${
                active
                  ? "border-[var(--fm-primary-dark)] bg-[var(--fm-hover)] text-[var(--fm-primary-dark)]"
                  : "border-[var(--fm-border)] bg-white text-[var(--fm-text)]"
              } disabled:bg-[var(--fm-surface-soft)] disabled:text-slate-400 disabled:opacity-65`}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div
        id="payment-method-options"
        role="tabpanel"
        aria-labelledby={`payment-category-${activeCategory}`}
        className="mt-4"
      >
        <div
          className="divide-y divide-[var(--fm-border)] border-y border-[var(--fm-border)]"
          role="radiogroup"
          aria-label="Payment method"
        >
          {visibleMethods.map((method) => {
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
      </div>
    </div>
  );
}
