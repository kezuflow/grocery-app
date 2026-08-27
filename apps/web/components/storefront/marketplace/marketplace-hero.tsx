import Link from "next/link";

/**
 * Marketplace hero heading block. Deliberately not a marketing hero — a scan
 * entry that states the delivery context and hands off to serviceability.
 */
export function MarketplaceHero() {
  return (
    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
          Fresh groceries for Cebu
        </p>
        <h1 className="mt-1.5 text-3xl font-bold leading-tight tracking-[-0.02em] sm:text-[32px]">
          Shop fresh, live well
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--fm-text-muted)]">
          Fresh produce, pantry essentials, and weekly picks for your home. Browse fixed weights and
          packs — delivery availability and final pricing are confirmed during checkout.
        </p>
      </div>
      <Link
        href="/serviceability"
        className="inline-flex min-h-10 shrink-0 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-4 text-sm font-semibold text-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)]"
      >
        Check delivery area
      </Link>
    </div>
  );
}
