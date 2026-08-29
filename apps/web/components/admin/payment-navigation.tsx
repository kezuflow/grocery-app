import Link from "next/link";

export function PaymentNavigation() {
  return (
    <nav aria-label="Payment administration" className="flex flex-wrap gap-3 text-sm">
      <Link className="underline" href="/admin/payments/overview">
        Overview
      </Link>
      <Link className="underline" href="/admin/payments/transactions">
        Transactions
      </Link>
      <Link className="underline" href="/admin/payments/reconciliation">
        Reconciliation
      </Link>
    </nav>
  );
}
