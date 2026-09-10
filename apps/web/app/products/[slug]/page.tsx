import { Suspense } from "react";
import { env } from "cloudflare:workers";
import { coreClient } from "../../../lib/core-client/core";
import { readBrowsingLocation } from "../../../lib/storefront/read-browsing-location";
import { withReadDeadline } from "../../../lib/http/read-deadline";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductView } from "./product-view";
import { StorefrontShell } from "../../../components/storefront/storefront-shell";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <StorefrontShell>
      <div className="w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--fm-primary-dark)] hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to groceries
        </Link>
        <div className="mt-5">
          <Suspense fallback={<p role="status">Loading product…</p>}>
            <ProductDetails slug={slug} />
          </Suspense>
        </div>
      </div>
    </StorefrontShell>
  );
}

async function ProductDetails({ slug }: { slug: string }) {
  try {
    const result = await withReadDeadline(
      (async () => {
        const locationId = await readBrowsingLocation();
        return coreClient(env.CORE).getCatalogProduct({
          requestId: crypto.randomUUID(),
          slug,
          locationId,
        });
      })(),
    );
    return <ProductView key={slug} view={result.ok ? result.value : null} />;
  } catch {
    return <ProductView key={slug} view={null} />;
  }
}
