import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Leaf, ShoppingBasket, Sprout } from "lucide-react";

const description =
  "FreshmarketsPH is a Cebu-based grocery delivery startup building technology to make fresh produce shopping easier and more affordable.";

export const metadata: Metadata = {
  title: "About FreshmarketsPH | FreshMarkets",
  description,
  alternates: { canonical: "https://freshmarkets.ph/about" },
  openGraph: {
    title: "About FreshmarketsPH",
    description,
    url: "https://freshmarkets.ph/about",
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-[var(--fm-storefront-accent)]">
          About FreshmarketsPH · Cebu, Philippines
        </p>
        <h1 className="fm-font-display mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Fresh groceries.
          <br />
          A simpler everyday shop.
        </h1>
        <p className="mt-6 text-lg leading-8 text-[var(--fm-text-muted)]">{description}</p>
        <p className="mt-4 leading-7 text-[var(--fm-text-muted)]">
          Our platform, freshmarkets.ph, connects customers with fresh vegetables, fruits, and
          groceries through a streamlined online ordering and delivery experience. We’re starting in
          Cebu, with a focus on the everyday essentials that keep households going.
        </p>
      </header>

      <section
        aria-labelledby="mission-heading"
        className="mt-12 border-t border-[var(--fm-border)] pt-10"
      >
        <h2 id="mission-heading" className="text-2xl font-semibold tracking-tight">
          Better shopping, from basket to doorstep
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-[var(--fm-text-muted)]">
          We believe fresh food should be easier to buy and easier to plan for. Our mission is to
          bring convenient grocery shopping and thoughtful technology together, helping customers
          spend less time arranging their groceries and more time enjoying them.
        </p>
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <div className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-card)] p-6">
            <ShoppingBasket
              className="size-6 text-[var(--fm-storefront-accent)]"
              aria-hidden="true"
            />
            <h3 className="mt-4 text-lg font-semibold">Everyday groceries, online</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--fm-text-muted)]">
              Browse produce and grocery essentials, place an order, and manage it in one place.
              Delivery availability is based on your confirmed address and current service areas.
            </p>
            <Link
              href="/serviceability"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-[var(--fm-storefront-accent)]! hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Check delivery areas <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-card)] p-6">
            <Leaf className="size-6 text-[var(--fm-storefront-accent)]" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold">Built around fresh food</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--fm-text-muted)]">
              Fresh vegetables, fruits, and practical household staples are at the heart of
              FreshmarketsPH. We’re building around the needs of local customers and the realities
              of grocery supply.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="technology-heading"
        className="mt-10 rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-6 sm:p-8"
      >
        <div className="flex items-center gap-3">
          <Sprout
            className="size-6 shrink-0 text-[var(--fm-storefront-accent)]"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[var(--fm-storefront-accent)]">
            What we’re developing
          </p>
        </div>
        <h2 id="technology-heading" className="mt-4 text-2xl font-semibold tracking-tight">
          Smarter planning. Less waste.
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-[var(--fm-text-muted)]">
          Beyond online ordering, we’re developing inventory forecasting and supplier pricing tools
          to reduce food waste, improve product availability, and keep prices competitive. Our goal
          is to help grocery operations better understand demand and make more informed purchasing
          decisions.
        </p>
        <p className="mt-4 text-sm leading-6 text-[var(--fm-text-muted)]">
          These tools are in development as we build the next stage of FreshmarketsPH.
        </p>
      </section>

      <section aria-labelledby="connect-heading" className="mt-12">
        <h2 id="connect-heading" className="text-2xl font-semibold tracking-tight">
          Let’s build something fresh
        </h2>
        <p className="mt-3 leading-7 text-[var(--fm-text-muted)]">
          Have a question, supply fresh products, or want to explore a partnership? We’d love to
          hear from you.
        </p>
        <Link
          href="/contact"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] px-5 font-semibold text-white! hover:bg-[var(--fm-storefront-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--fm-storefront-accent)]"
        >
          Get in touch <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </section>
    </article>
  );
}
