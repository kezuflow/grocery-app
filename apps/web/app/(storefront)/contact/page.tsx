import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail, MapPin } from "lucide-react";

const description =
  "Contact FreshmarketsPH in Cebu, Philippines for customer questions, supplier inquiries, and partnerships.";

export const metadata: Metadata = {
  title: "Contact & Inquiries | FreshmarketsPH",
  description,
  alternates: { canonical: "https://freshmarkets.ph/contact" },
  openGraph: {
    title: "Contact FreshmarketsPH",
    description,
    url: "https://freshmarkets.ph/contact",
    type: "website",
  },
};

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-[var(--fm-storefront-accent)]">
          Contact & inquiries
        </p>
        <h1 className="fm-font-display mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Let’s talk fresh.
        </h1>
        <p className="mt-6 text-lg leading-8 text-[var(--fm-text-muted)]">
          Whether you’re shopping for groceries, supplying fresh produce, or exploring a
          partnership, we’d love to hear from you.
        </p>
      </header>

      <section
        aria-labelledby="email-heading"
        className="mt-10 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-card)] p-6 sm:p-8"
      >
        <Mail className="size-7 text-[var(--fm-storefront-accent)]" aria-hidden="true" />
        <h2 id="email-heading" className="mt-4 text-2xl font-semibold tracking-tight">
          Contacts & inquiries
        </h2>
        <p className="mt-3 leading-7 text-[var(--fm-text-muted)]">
          Email Reggie for questions about FreshmarketsPH, supplier opportunities, partnerships, and
          general inquiries.
        </p>
        <a
          href="mailto:reggie@freshmarkets.ph"
          className="mt-5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-sm text-lg font-semibold text-[var(--fm-storefront-accent)]! hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <span className="break-all">reggie@freshmarkets.ph</span>
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </a>
        <p className="mt-4 text-sm leading-6 text-[var(--fm-text-muted)]">
          Tell us a little about your inquiry. For supplier inquiries, include the products you
          offer and where you’re based.
        </p>
      </section>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section
          aria-labelledby="location-heading"
          className="rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-6"
        >
          <MapPin className="size-6 text-[var(--fm-storefront-accent)]" aria-hidden="true" />
          <h2 id="location-heading" className="mt-4 text-lg font-semibold">
            Rooted in Cebu
          </h2>
          <p className="mt-3 leading-7 text-[var(--fm-text-muted)]">Cebu, Philippines</p>
          <p className="mt-2 text-sm leading-6 text-[var(--fm-text-muted)]">
            We’re a Cebu-based grocery delivery startup. Check our delivery areas to see
            availability for your address.
          </p>
          <Link
            href="/serviceability"
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-[var(--fm-storefront-accent)]! hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Check delivery areas <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
        <section
          aria-labelledby="order-help-heading"
          className="rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-6"
        >
          <h2 id="order-help-heading" className="text-lg font-semibold">
            Need help with an order?
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--fm-text-muted)]">
            Sign in and open your order to view its details and use the available order messaging.
            Keeping the conversation with your order helps us understand what you need.
          </p>
          <Link
            href="/orders"
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-[var(--fm-storefront-accent)]! hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            View your orders <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
      </div>

      <p className="mt-10 text-sm leading-6 text-[var(--fm-text-muted)]">
        Get to know our story and what we’re building on our{" "}
        <Link
          href="/about"
          className="rounded-sm font-semibold text-[var(--fm-storefront-accent)]! underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          About page
        </Link>
        .
      </p>
    </article>
  );
}
