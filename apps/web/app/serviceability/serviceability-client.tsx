"use client";

import Link from "next/link";
import { AddressEditor } from "../../components/storefront/address/address-editor";
import { StorefrontShell } from "../../components/storefront/storefront-shell";

export function ServiceabilityClient({ publicAccessToken }: { publicAccessToken?: string }) {
  return (
    <StorefrontShell>
      <div className="min-h-[100dvh] w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <Link href="/" className="text-sm font-semibold underline underline-offset-4">
          Back to marketplace
        </Link>
        <div className="mt-6 max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Cebu delivery coverage
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em]">Check serviceability</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--fm-text-muted)]">
            Search for a destination and confirm its exact entrance. Core checks current coverage;
            you do not need to sign in or save the address.
          </p>
          <section className="mt-7 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
            <AddressEditor purpose="serviceability" publicAccessToken={publicAccessToken} />
          </section>
        </div>
      </div>
    </StorefrontShell>
  );
}
