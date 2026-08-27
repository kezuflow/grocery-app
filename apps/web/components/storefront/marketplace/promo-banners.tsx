import Link from "next/link";

/**
 * Restrained promotion modules for the marketplace home. Copy stays inside
 * approved FreshMarkets membership and seasonal merchandising facts.
 */
export function PromoBanners() {
  return (
    <div
      data-testid="storefront-promo-banner"
      className="relative flex min-h-32 items-center justify-between gap-6 overflow-hidden rounded-[var(--fm-radius-surface)] bg-[var(--fm-primary-dark)] px-5 py-4 text-white sm:px-7"
    >
      <div className="relative z-10 max-w-xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--fm-primary-lime)]">
          Fresh this week
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-[-0.02em] sm:text-2xl">
          Seasonal picks, packed fresh.
        </h2>
        <p className="mt-1 max-w-md text-sm text-white/75">
          Stock up on produce and pantry staples for your next basket.
        </p>
        <Link
          href="/?category=fruits"
          className="mt-3 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-4 text-sm font-bold text-[var(--fm-primary-dark)] hover:bg-[#c4fa69]"
        >
          Shop fresh picks
        </Link>
      </div>
      <div className="hidden shrink-0 items-center pr-4 sm:flex" aria-hidden="true">
        <img
          src="/produce/avocado.webp"
          alt=""
          className="size-20 rotate-3 rounded-[var(--fm-radius-surface)] bg-white object-contain p-2"
        />
        <img
          src="/produce/strawberry.webp"
          alt=""
          className="-ml-4 size-24 -rotate-6 rounded-[var(--fm-radius-surface)] bg-white object-contain p-2 shadow-sm"
        />
      </div>
    </div>
  );
}

/**
 * Membership context strip stating the checkout gate in customer language.
 */
export function MembershipStrip() {
  return (
    <div
      data-testid="storefront-membership-strip"
      className="flex flex-col gap-2 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        <strong className="font-semibold">Membership eligibility is checked at checkout.</strong>{" "}
        <span className="text-[var(--fm-text-muted)]">
          One introductory calendar month is included, then ₱299/month.
        </span>
      </p>
      <Link
        href="/account"
        className="shrink-0 font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
      >
        See membership benefits
      </Link>
    </div>
  );
}
