import Link from "next/link";
import type { ReactNode } from "react";

const footerLinkClassName =
  "w-fit rounded-sm text-sm text-[var(--fm-text-muted)] transition-colors hover:text-[var(--fm-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-primary-dark)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fm-surface-soft)]";

export function StorefrontFooter() {
  return (
    <footer
      aria-label="Storefront footer"
      className="border-t border-[var(--fm-border)] bg-[var(--fm-surface-soft)] pb-24 pt-10 lg:pb-8"
    >
      <div className="mx-auto grid w-full max-w-[var(--fm-container-content)] grid-cols-2 gap-x-6 gap-y-9 px-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-[1.5fr_repeat(3,1fr)] lg:px-8">
        <div className="col-span-2 max-w-xs sm:col-span-3 lg:col-span-1">
          <Link
            href="/"
            className="fm-font-display inline-flex items-center gap-2 rounded-sm text-lg font-bold text-[var(--fm-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-primary-dark)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fm-surface-soft)]"
          >
            <span
              aria-hidden="true"
              className="inline-block size-6 rounded-[6px] bg-[var(--fm-primary-lime)]"
            />
            freshmarkets
          </Link>
          <p className="mt-4 text-sm leading-6 text-[var(--fm-text-muted)]">
            Fresh groceries and everyday essentials, delivered in supported Cebu areas.
          </p>
        </div>

        <FooterLinkGroup title="Shop">
          <Link href="/?category=all" className={footerLinkClassName}>
            All groceries
          </Link>
          <Link href="/#daily-deals" className={footerLinkClassName}>
            Deals
          </Link>
          <Link href="/serviceability" className={footerLinkClassName}>
            Delivery areas
          </Link>
        </FooterLinkGroup>

        <FooterLinkGroup title="Account">
          <Link href="/orders" className={footerLinkClassName}>
            Orders
          </Link>
          <Link href="/account" className={footerLinkClassName}>
            Account
          </Link>
          <Link href="/account/addresses" className={footerLinkClassName}>
            Delivery addresses
          </Link>
        </FooterLinkGroup>

        <FooterLinkGroup title="Help">
          <a
            href="mailto:support@freshmarkets.ph"
            className={`${footerLinkClassName} flex flex-col gap-1`}
          >
            <span>Contact FreshMarkets</span>
            <span className="text-xs">support@freshmarkets.ph</span>
          </a>
        </FooterLinkGroup>
      </div>

      <div className="mx-auto mt-10 flex w-full max-w-[var(--fm-container-content)] flex-col gap-2 border-t border-[var(--fm-border)] px-4 pt-5 text-xs text-[var(--fm-text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>© FreshMarkets</p>
        <p>Cebu, Philippines</p>
      </div>
    </footer>
  );
}

function FooterLinkGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={`${title} links`}>
      <h2 className="text-sm font-semibold text-[var(--fm-text)]">{title}</h2>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </nav>
  );
}
