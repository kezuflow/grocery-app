"use client";

import { CreditCard, Landmark, QrCode, WalletCards } from "lucide-react";
import type { PaymentMethodToken } from "@freshmarkets/contracts";

type Method = Readonly<{
  value: string;
  label: string;
  description: string;
  category: "qr" | "wallet" | "card" | "bank";
  available: boolean;
}>;

const methods: readonly Method[] = [
  {
    value: "qrph",
    label: "QR Ph",
    description: "Scan with GCash, Maya, or a participating bank app.",
    category: "qr",
    available: true,
  },
  { value: "gcash", label: "GCash", description: "E-wallet", category: "wallet", available: false },
  {
    value: "paymaya",
    label: "Maya",
    description: "E-wallet",
    category: "wallet",
    available: false,
  },
  {
    value: "grab_pay",
    label: "GrabPay",
    description: "E-wallet",
    category: "wallet",
    available: false,
  },
  {
    value: "shopeepay",
    label: "ShopeePay",
    description: "E-wallet",
    category: "wallet",
    available: false,
  },
  {
    value: "card",
    label: "Visa & Mastercard",
    description: "Card",
    category: "card",
    available: false,
  },
  {
    value: "google_pay",
    label: "Google Pay",
    description: "Digital wallet",
    category: "wallet",
    available: false,
  },
  { value: "bdo", label: "BDO", description: "Direct debit", category: "bank", available: false },
  { value: "bpi", label: "BPI", description: "Direct debit", category: "bank", available: false },
  {
    value: "landbank",
    label: "Landbank",
    description: "Direct debit",
    category: "bank",
    available: false,
  },
  {
    value: "metrobank",
    label: "Metrobank",
    description: "Direct debit",
    category: "bank",
    available: false,
  },
  { value: "rcbc", label: "RCBC", description: "Direct debit", category: "bank", available: false },
  {
    value: "ubp",
    label: "UnionBank",
    description: "Direct debit",
    category: "bank",
    available: false,
  },
] as const;

function MethodIcon({ category }: { category: Method["category"] }) {
  const className = "size-5";
  if (category === "qr") return <QrCode className={className} aria-hidden="true" />;
  if (category === "card") return <CreditCard className={className} aria-hidden="true" />;
  if (category === "bank") return <Landmark className={className} aria-hidden="true" />;
  return <WalletCards className={className} aria-hidden="true" />;
}

export function PaymentMethodPicker({
  selected,
  onSelect,
}: {
  selected: PaymentMethodToken | null;
  onSelect: (method: PaymentMethodToken) => void;
}) {
  return (
    <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Payment method">
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
            className={`flex min-h-16 items-center gap-3 rounded-[var(--fm-radius-control)] border px-4 py-3 text-left transition-colors ${
              checked
                ? "border-[var(--fm-primary-dark)] bg-[var(--fm-primary-lime-soft)]"
                : "border-[var(--fm-border)] bg-white"
            } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
          >
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-full ${
                checked
                  ? "bg-[var(--fm-primary-dark)] text-white"
                  : "bg-slate-100 text-[var(--fm-text-muted)]"
              }`}
            >
              <MethodIcon category={method.category} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-current">{method.label}</span>
              <span className="mt-0.5 block text-xs text-[var(--fm-text-muted)]">
                {method.description}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                method.available ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
              }`}
            >
              {method.available ? (checked ? "Selected" : "Available") : "Not active"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
