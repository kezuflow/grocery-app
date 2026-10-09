import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, Leaf, ShoppingBasket, Sprout } from "lucide-react";

const description =
  "FreshmarketsPH is a grocery technology startup based in Cebu, Philippines. We operate Freshmarkets, our online grocery ordering and delivery platform.";

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://freshmarkets.ph/#organization",
  name: "FreshmarketsPH",
  url: "https://freshmarkets.ph",
  description,
  brand: { "@type": "Brand", name: "Freshmarkets" },
  email: "reggie@freshmarkets.ph",
  location: { "@type": "Place", name: "Cebu, Philippines" },
  sameAs: ["https://www.facebook.com/freshmarketsph/"],
};

export const metadata: Metadata = {
  title: "About FreshmarketsPH | Freshmarkets",
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, "\\u003c") }}
      />
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-[var(--fm-storefront-accent)]">
          About FreshmarketsPH · Cebu, Philippines
        </p>
        <h1 className="fm-font-display mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          The team behind Freshmarkets
        </h1>
        <p className="mt-6 text-lg leading-8 text-[var(--fm-text-muted)]">{description}</p>
        <p className="mt-4 leading-7 text-[var(--fm-text-muted)]">
          Freshmarkets is our customer-facing grocery delivery platform at freshmarkets.ph. It’s
          where customers shop for fresh vegetables, fruits, and everyday groceries. FreshmarketsPH
          is the startup building the technology and running the grocery operations behind it.
        </p>
      </header>

      <section
        aria-labelledby="mission-heading"
        className="mt-12 border-t border-[var(--fm-border)] pt-10"
      >
        <h2 id="mission-heading" className="text-2xl font-semibold tracking-tight">
          Grocery ordering and fulfillment today
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-[var(--fm-text-muted)]">
          Freshmarkets is a live ordering service. Customers browse groceries, add items to their
          cart, check out, and follow their orders online. Our team sources groceries, prepares
          orders, and arranges delivery in supported areas of Cebu. Customers confirm their delivery
          location to see current prices and availability before ordering.
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
            <h3 className="mt-4 text-lg font-semibold">From order to delivery</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--fm-text-muted)]">
              Our operations cover sourcing, order preparation, and delivery coordination. The
              platform helps our team manage this work alongside customer orders.
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
          Tools we’re still building
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-[var(--fm-text-muted)]">
          We’re developing inventory forecasting to plan stock levels, supplier price analysis to
          compare purchasing costs, demand prediction to understand what customers may need, and
          procurement optimization to help decide what to buy and when. We want these tools to
          support our grocery operations and help reduce waste.
        </p>
        <p className="mt-4 text-sm leading-6 text-[var(--fm-text-muted)]">
          These advanced capabilities are still in development. They are not available as live
          features of Freshmarkets today.
        </p>
      </section>

      <section aria-labelledby="connect-heading" className="mt-12">
        <h2 id="connect-heading" className="text-2xl font-semibold tracking-tight">
          Find us and get in touch
        </h2>
        <p className="mt-3 leading-7 text-[var(--fm-text-muted)]">
          We’re based in Cebu, Philippines. Contact FreshmarketsPH for questions about the platform,
          supplier opportunities, or potential partnerships, or visit our official Facebook page.
        </p>
        <Link
          href="/contact"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] px-5 font-semibold text-white! hover:bg-[var(--fm-storefront-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--fm-storefront-accent)]"
        >
          Get in touch <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
          <a
            href="mailto:reggie@freshmarkets.ph"
            className="inline-flex min-h-11 max-w-full items-center rounded-sm font-semibold text-[var(--fm-text-muted)]! hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <span className="break-all">reggie@freshmarkets.ph</span>
          </a>
          <a
            href="https://www.facebook.com/freshmarketsph/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm font-semibold text-[var(--fm-text-muted)]! hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            FreshmarketsPH on Facebook
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </section>
    </article>
  );
}
