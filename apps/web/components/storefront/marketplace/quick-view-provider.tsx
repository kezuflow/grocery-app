"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PresentationProduct } from "../../../lib/storefront/catalog-presentation";
import { ProductQuickView } from "./product-quick-view";

type QuickViewContextValue = {
  openProduct: (slug: string) => void;
};

const QuickViewContext = createContext<QuickViewContextValue | null>(null);

export function useQuickView(): QuickViewContextValue {
  const context = useContext(QuickViewContext);
  if (!context) throw new Error("useQuickView requires QuickViewProvider");
  return context;
}

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
