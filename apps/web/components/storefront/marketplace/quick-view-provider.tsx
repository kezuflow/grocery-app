"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PresentationProduct } from "../../../lib/storefront/catalog-presentation";
import { QuickViewContext } from "./quick-view-context";
import { ProductQuickView } from "./product-quick-view";

/**
 * Wraps a marketplace surface with a single lazy product dialog. Receives the
 * surface's presentation products so recommendations resolve client-side from
 * already-loaded catalog data instead of extra requests.
 */
export function QuickViewProvider({
  products,
  children,
}: {
  products: ReadonlyArray<PresentationProduct>;
  children: ReactNode;
}) {
  const [slug, setSlug] = useState<string | null>(null);
  const openProduct = useCallback((next: string) => setSlug(next), []);
  const value = useMemo(() => ({ openProduct }), [openProduct]);
  return (
    <QuickViewContext.Provider value={value}>
      {children}
      <ProductQuickView
        slug={slug}
        products={products}
        onClose={() => setSlug(null)}
        onNavigate={setSlug}
      />
    </QuickViewContext.Provider>
  );
}
