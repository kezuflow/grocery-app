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
          <ProductView slug={slug} />
        </div>
      </div>
    </StorefrontShell>
  );
}
