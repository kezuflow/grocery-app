import Link from "next/link";

/**
 * Restrained promotion modules for the marketplace home. Copy stays inside
 * approved FreshMarkets membership and seasonal merchandising facts.
 */
export function PromoBanners() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article className="flex items-center justify-between gap-4 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] p-5">
        <div className="max-w-[60%]">
          <h2 className="text-lg font-bold tracking-[-0.01em]">FreshMarkets membership</h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            One introductory calendar month is included, then ₱299/month. Membership eligibility is
            confirmed before checkout.
          </p>
          <Link
            href="/account"
            className="mt-3 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-semibold text-white hover:bg-[#294f30]"
          >
            View membership
          </Link>
        </div>
        <div className="hidden shrink-0 items-center sm:flex" aria-hidden="true">
          <img
            src="/produce/pineapple.webp"
            alt=""
            className="size-20 -rotate-6 rounded-[var(--fm-radius-surface)] bg-white object-contain p-2"
          />
          <img
            src="/produce/mango-carabao.webp"
            alt=""
            className="-ml-4 size-24 rotate-3 rounded-[var(--fm-radius-surface)] bg-white object-contain p-2 shadow-sm"
          />
        </div>
      </article>
      <article className="flex items-center justify-between gap-4 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] p-5">
        <div className="max-w-[60%]">
          <h2 className="text-lg font-bold tracking-[-0.01em]">Fresh this week</h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Seasonal favorites restocked for your next basket.
          </p>
          <Link
            href="/?category=fruits"
            className="mt-3 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-semibold text-white hover:bg-[#294f30]"
          >
            Shop seasonal picks
          </Link>
        </div>
        <div className="hidden shrink-0 items-center sm:flex" aria-hidden="true">
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
      </article>
    </div>
  );
}

/**
 * Membership context strip stating the checkout gate in customer language.
 */
export function MembershipStrip() {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>
        <strong className="font-semibold">Membership eligibility is checked at checkout.</strong>{" "}
        <span className="text-[var(--fm-text-muted)]">
          One free introductory calendar month, then ₱299/month.
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
