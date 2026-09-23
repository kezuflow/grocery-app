import Link from "next/link";
import { ShoppingBag } from "lucide-react";

export default function RetailPage() {
  return (
    <>
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <ShoppingBag
          className="mx-auto mb-5 size-10 text-[var(--fm-primary-dark)]"
          aria-hidden="true"
        />
        <h1 className="text-3xl font-bold">Retail</h1>
        <p className="mt-3 text-[var(--fm-text-muted)]">
          Retail shopping isn’t available yet. You can browse our fresh groceries in the meantime.
        </p>
        <Link
          href="/?category=all"
          className="mt-6 inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] px-5 font-semibold text-white! transition-colors hover:bg-[var(--fm-storefront-action-hover)]"
        >
          Browse all groceries
        </Link>
      </div>
    </>
  );
}
