import { env } from "cloudflare:workers";
import { notFound } from "next/navigation";
import { MockPaymentControls } from "./mock-payment-controls";

function safeReturnPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/orders";
}

export default async function MockPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ "provider-reference": string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  if (env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test") notFound();
  const [{ "provider-reference": providerReference }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <main className="fm-storefront min-h-[100dvh] bg-[var(--fm-surface-soft)] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
          Development tools
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em]">Local payment simulator</h1>
        <p className="mt-3 text-sm text-[var(--fm-text-muted)]">
          Choose the provider outcome to test. This page is unavailable in preview, staging, and
          production.
        </p>
        <div className="mt-8">
          <MockPaymentControls
            providerReference={providerReference}
            returnTo={safeReturnPath(query.returnTo)}
          />
        </div>
      </div>
    </main>
  );
}
