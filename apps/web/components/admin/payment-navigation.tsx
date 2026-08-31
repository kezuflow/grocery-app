"use client";

import { usePathname } from "next/navigation";
import { SettingsTabs } from "./admin-compositions";

const tabs = [
  { id: "overview", label: "Overview", href: "/admin/payments/overview" },
  { id: "transactions", label: "Transactions", href: "/admin/payments/transactions" },
  { id: "reconciliation", label: "Reconciliation", href: "/admin/payments/reconciliation" },
];

export function PaymentNavigation() {
  const pathname = usePathname();
  const activeId = pathname.includes("/reconciliation")
    ? "reconciliation"
    : pathname.includes("/transactions")
      ? "transactions"
      : "overview";
  return <SettingsTabs activeId={activeId} label="Payment administration" tabs={tabs} />;
}
