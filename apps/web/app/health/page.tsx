import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { StorefrontShell } from "../../components/storefront/storefront-shell";

export default function HealthPage() {
  return (
    <StorefrontShell>
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <HeartPulse
          className="mx-auto mb-5 size-10 text-[var(--fm-primary-dark)]"
          aria-hidden="true"
        />
        <h1 className="text-3xl font-bold">Health</h1>
        <p className="mt-3 text-[var(--fm-text-muted)]">
          Health shopping isn’t available yet. You can browse our fresh groceries in the meantime.
        </p>
        <Link
          href="/?category=all"
          className="mt-6 inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-5 font-semibold text-[var(--fm-primary-dark)]"
        >
          Browse all groceries
        </Link>
      </div>
    </StorefrontShell>
  );
}
